// url_manager.js (v6.0 - Native Fetch & Atomic Locking)

const { db } = require('./database.js');
const config = require('./config.js');

function getNewTarget() {
    const min = config.targetTrafficMin || 1000;
    const max = config.targetTrafficMax || 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateBitlyLink(longUrl) {
    const token = process.env.BITLY_API;
    if (!token) { console.error('[UrlManager] ❌ ERROR: BITLY_API missing!'); return null; }
    
    try {
        if (config.DEBUG_MODE) console.log(`[UrlManager] ⏳ Menghubungi Bitly: ${longUrl.substring(0, 30)}...`);
        
        const response = await fetch('https://api-ssl.bitly.com/v4/shorten', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ long_url: longUrl, domain: "bit.ly" })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.link) {
                if (config.DEBUG_MODE) console.log(`[UrlManager] ✅ Bitly Created: ${data.link}`);
                return data.link;
            }
        }
    } catch (error) {
        console.error(`[UrlManager] ❌ Bitly Gagal: ${error.message}`);
        return null;
    }
    return null;
}

async function getNextTarget() {
    // 1. Query Standard
    const pipeline = [
        { 
            $match: { 
                $or: [
                    { hit_count: null }, 
                    { 
                        $and: [
                            { hit_count: { $ne: null } },
                            { hit_target: { $ne: null } },
                            { $expr: { $lt: ["$hit_count", "$hit_target"] } }
                        ]
                    }
                ]
            } 
        },
        { $sample: { size: 1 } }
    ];

    const result = await db().collection('urls').aggregate(pipeline).toArray();
    if (!result || result.length === 0) {
        if (config.DEBUG_MODE) console.log(`[UrlManager] ⚠️ Tidak ada URL tersedia.`);
        return null; 
    }

    const doc = result[0];
    let updates = {};
    let needDbUpdate = false;

    // Init Data Null
    if (doc.hit_count === null) { updates.hit_count = 0; doc.hit_count = 0; needDbUpdate = true; }
    if (doc.hit_target === null) { updates.hit_target = getNewTarget(); doc.hit_target = updates.hit_target; needDbUpdate = true; }

    // --- LOGIKA SHORTLINK (ATOMIC LOCK) ---
    let finalUrl = doc.url;
    let isShortlink = false;
    
    const probability = config.shortlinkProbability !== undefined ? config.shortlinkProbability : 80;
    const useShortlink = (Math.random() * 100) < probability;

    if (useShortlink) {
        if (doc.short_link && doc.short_link.length > 5 && doc.short_link !== 'PENDING') {
            // Case A: Sudah ada -> Pakai
            finalUrl = doc.short_link;
            isShortlink = true;
        } else if (!doc.short_link) {
            // Case B: Belum ada -> COBA LOCKING
            const lockResult = await db().collection('urls').findOneAndUpdate(
                { _id: doc._id, short_link: null },
                { $set: { short_link: 'PENDING' } }
            );

            if (lockResult) {
                // KITA PEMENANG RACE!
                const newShort = await generateBitlyLink(doc.url);
                if (newShort) {
                    updates.short_link = newShort;
                    finalUrl = newShort;
                    isShortlink = true;
                    needDbUpdate = true;
                } else {
                    // Gagal API -> Revert
                    await db().collection('urls').updateOne({ _id: doc._id }, { $set: { short_link: null } });
                    finalUrl = doc.url;
                }
            } else {
                // KALAH RACE
                const freshDoc = await db().collection('urls').findOne({ _id: doc._id });
                if (freshDoc.short_link && freshDoc.short_link !== 'PENDING') {
                    finalUrl = freshDoc.short_link;
                    isShortlink = true;
                } else {
                    finalUrl = doc.url;
                }
            }
        } else {
            // Case C: Sedang PENDING -> Pakai Original
            finalUrl = doc.url;
        }
    }

    if (needDbUpdate) {
        await db().collection('urls').updateOne({ _id: doc._id }, { $set: updates });
    }

    return {
        _id: doc._id,
        url: finalUrl,
        originalUrl: doc.url,
        referrers: doc.referrers,
        isShortlink: isShortlink
    };
}

module.exports = { getNextTarget };