const supabase = require('../utils/supabaseClient');
const axios = require('axios');
const crypto = require('node:crypto');

const dmarketPublicKey = process.env.DMARKET_PUBLIC_KEY;
const dmarketSecretKey = process.env.DMARKET_SECRET_KEY;

// --- Helper Function to Fetch DMarket Price ---
async function getDMarketPrice(skinName) {
    if (!dmarketPublicKey || !dmarketSecretKey) {
        console.error('[AlertChecker] DMarket keys missing.');
        return null;
    }
    try {
        const method = 'GET';
        const apiPath = '/exchange/v1/market/items';
        const queryParams = new URLSearchParams({
            gameId: 'rust',
            currency: 'USD',
            title: skinName,
            limit: '5' // Fetch a few offers to find the lowest
        }).toString();
        
        const host = 'https://api.dmarket.com';
        const url = `${host}${apiPath}?${queryParams}`;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const stringToSign = `${method}${apiPath}?${queryParams}${timestamp}`;

        const signature = crypto
            .createHmac('sha256', dmarketSecretKey)
            .update(stringToSign)
            .digest('hex');

        // console.log(`[AlertChecker] Fetching DMarket price for: ${skinName}`); // Verbose logging
        const response = await axios.get(url, {
            headers: {
                'X-Api-Key': dmarketPublicKey,
                'X-Request-Sign': `dmar_${signature}`,
                'X-Sign-Timestamp': timestamp,
                'Content-Type': 'application/json' 
            },
            timeout: 8000 // Slightly shorter timeout for background task
        });

        if (response.data && response.data.objects && response.data.objects.length > 0) {
            const offers = response.data.objects;
            offers.sort((a, b) => parseFloat(a.price.USD) - parseFloat(b.price.USD));
            const lowestPriceCents = parseFloat(offers[0].price.USD);
            return lowestPriceCents / 100; // Return price as a number (e.g., 127.98)
        } else {
            // console.warn(`[AlertChecker] No DMarket offers found for ${skinName}`);
            return null; // Indicate not found or no offers
        }

    } catch (fetchError) {
        console.error(`[AlertChecker] Error fetching DMarket price for ${skinName}:`, fetchError.message);
        if (fetchError.response) {
             console.error(`[AlertChecker] DMarket Status: ${fetchError.response.status}`);
        }
        return null; // Indicate fetch error
    }
}

// --- Main Alert Checking Logic ---
async function checkAlerts(client) {
    if (!supabase) {
        console.warn('[AlertChecker] Supabase client not ready, skipping check.');
        return;
    }
    console.log('[AlertChecker] Starting alert check...');

    try {
        // 1. Fetch active alerts and associated skin names
        const { data: activeAlerts, error: fetchError } = await supabase
            .from('alerts')
            .select(`
                id,
                user_discord_id,
                target_price,
                alert_condition,
                skin_id,
                skins ( name ) 
            `)
            .eq('is_active', true);

        if (fetchError) {
            console.error('[AlertChecker] Error fetching active alerts:', fetchError);
            return;
        }

        if (!activeAlerts || activeAlerts.length === 0) {
            console.log('[AlertChecker] No active alerts found.');
            return;
        }

        console.log(`[AlertChecker] Found ${activeAlerts.length} active alerts.`);

        // 2. Get unique skin names to fetch prices for
        const skinNamesToFetch = [...new Set(activeAlerts.map(alert => alert.skins?.name).filter(name => !!name))];
        const currentPrices = {}; // Store fetched prices { skinName: price }

        console.log(`[AlertChecker] Fetching prices for ${skinNamesToFetch.length} unique skins...`);
        for (const skinName of skinNamesToFetch) {
            const price = await getDMarketPrice(skinName);
            if (price !== null) {
                currentPrices[skinName] = price;
            }
            // IMPORTANT: Add delay to avoid DMarket rate limits
            await new Promise(resolve => setTimeout(resolve, 750)); // 750ms delay between API calls
        }
        console.log('[AlertChecker] Finished fetching prices.');

        // 3. Process alerts
        let notificationsSent = 0;
        for (const alert of activeAlerts) {
            const skinName = alert.skins?.name;
            if (!skinName || currentPrices[skinName] === undefined) {
                // console.log(`[AlertChecker] Skipping alert ID ${alert.id}: Missing skin name or price not fetched.`);
                continue; // Skip if skin name is missing or price fetch failed
            }

            const currentPrice = currentPrices[skinName];
            let conditionMet = false;

            if (alert.alert_condition === 'below' && currentPrice < alert.target_price) {
                conditionMet = true;
            }
            if (alert.alert_condition === 'above' && currentPrice > alert.target_price) {
                conditionMet = true;
            }

            if (conditionMet) {
                console.log(`[AlertChecker] Condition met for alert ID ${alert.id}! Skin: ${skinName}, Current: $${currentPrice.toFixed(2)}, Target: ${alert.alert_condition} $${alert.target_price.toFixed(2)}`);
                notificationsSent++;

                // Deactivate the alert
                const { error: updateError } = await supabase
                    .from('alerts')
                    .update({ is_active: false })
                    .eq('id', alert.id);
                
                if (updateError) {
                    console.error(`[AlertChecker] Failed to deactivate alert ID ${alert.id}:`, updateError);
                    // Continue trying to notify user even if deactivation fails
                }

                // Send DM notification
                try {
                    const user = await client.users.fetch(alert.user_discord_id);
                    if (user) {
                        await user.send(`🔔 **Price Alert Triggered!**\n**${skinName}** is now **$${currentPrice.toFixed(2)}** (Your target: ${alert.alert_condition} $${alert.target_price.toFixed(2)}).`);
                         console.log(`[AlertChecker] Sent DM to user ${alert.user_discord_id}`);
                    } else {
                         console.warn(`[AlertChecker] Could not find user with ID ${alert.user_discord_id}`);
                    }
                } catch (dmError) {
                    console.error(`[AlertChecker] Failed to send DM to user ${alert.user_discord_id}:`, dmError.message);
                }
                
                // Optional delay after processing a triggered alert
                // await new Promise(resolve => setTimeout(resolve, 500)); 
            }
        }

        console.log(`[AlertChecker] Check finished. ${notificationsSent} notifications sent.`);

    } catch (error) {
        console.error('[AlertChecker] Unexpected error during check:', error);
    }
}

// --- Function to Start the Interval ---
function startAlertChecker(client, intervalMinutes = 5) {
    console.log(`[AlertChecker] Starting checker loop every ${intervalMinutes} minutes.`);
    // Run immediately once on startup, then start the interval
    checkAlerts(client).catch(err => console.error("[AlertChecker] Initial run failed:", err)); 

    setInterval(() => {
        checkAlerts(client).catch(err => console.error("[AlertChecker] Interval run failed:", err));
    }, intervalMinutes * 60 * 1000); // Convert minutes to milliseconds
}

module.exports = { startAlertChecker }; 