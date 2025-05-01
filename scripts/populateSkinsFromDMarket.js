// Script to fetch available Rust skins from DMarket listings and populate the Supabase DB

// Load .env file from the current working directory (project root)
require('dotenv').config(); 

// --- Add Debugging --- 
console.log('--- Environment Variables Loaded by Script ---');
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? 'Loaded' : 'MISSING'}`);
console.log(`SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'Loaded' : 'MISSING'}`);
console.log(`DMARKET_PUBLIC_KEY: ${process.env.DMARKET_PUBLIC_KEY ? 'Loaded' : 'MISSING'}`);
// Avoid logging the secret key directly
console.log(`DMARKET_SECRET_KEY: ${process.env.DMARKET_SECRET_KEY ? 'Loaded' : 'MISSING'}`);
console.log('---------------------------------------------');
// --- End Debugging ---

const axios = require('axios');
const crypto = require('node:crypto');
const supabase = require('../utils/supabaseClient'); // Assuming utils path is correct relative to scripts

const dmarketPublicKey = process.env.DMARKET_PUBLIC_KEY;
const dmarketSecretKey = process.env.DMARKET_SECRET_KEY;

const API_HOST = 'https://api.dmarket.com';
const PAGE_LIMIT = 100; // Max items per DMarket request
const DELAY_MS = 500; // Delay between DMarket API calls

// Function to make signed DMarket API calls (adapted from price command)
async function callDMarketAPI(path, queryParams = {}) {
    if (!dmarketPublicKey || !dmarketSecretKey) {
        throw new Error('DMarket API keys missing.');
    }
    const method = 'GET';
    
    // Filter out undefined query params before creating the search string
    const filteredParams = {};
    for (const key in queryParams) {
        if (queryParams[key] !== undefined) {
            filteredParams[key] = queryParams[key];
        }
    }
    const queryString = new URLSearchParams(filteredParams).toString();
    
    const url = queryString ? `${API_HOST}${path}?${queryString}` : `${API_HOST}${path}`; // Handle case with no query params
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Construct StringToSign carefully, include ? only if queryString exists
    const stringToSign = queryString ? `${method}${path}?${queryString}${timestamp}` : `${method}${path}${timestamp}`;

    const signature = crypto
        .createHmac('sha256', dmarketSecretKey)
        .update(stringToSign)
        .digest('hex');

    // --- Add Detailed Request Logging ---
    console.log(`[DMarket Request] Method: ${method}`);
    console.log(`[DMarket Request] URL: ${url}`);
    console.log(`[DMarket Request] Timestamp: ${timestamp}`);
    console.log(`[DMarket Request] StringToSign: ${stringToSign}`);
    console.log(`[DMarket Request] Signature: dmar_${signature}`);
    // --- End Detailed Request Logging ---

    try {
        const response = await axios.get(url, {
            headers: {
                'X-Api-Key': dmarketPublicKey,
                'X-Request-Sign': `dmar_${signature}`,
                'X-Sign-Timestamp': timestamp,
                'Content-Type': 'application/json' 
            },
            timeout: 15000 // Longer timeout for potentially larger requests
        });
        return response.data;
    } catch (error) {
        console.error(`Error calling DMarket API (${path}): ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, error.response.data);
        }
        throw error; // Re-throw error to stop the process if needed
    }
}

// Function to add delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function to fetch and populate skins
async function populateSkins() {
    if (!supabase) {
        console.error('Supabase client not initialized. Make sure environment variables are correct.');
        return;
    }
    console.log('Starting DMarket skin population...');
    const allSkins = new Map(); // Use Map to store unique skins { name: { name, market_hash_name, icon_url? } }
    let cursor = '';
    let pageCount = 0;
    let totalFetched = 0;

    try {
        do {
            pageCount++;
            console.log(`Fetching page ${pageCount} (Cursor: ${cursor || ''})...`);
            
            // Construct queryParams, explicitly setting cursor only if it has a value
            const queryParams = {
                gameId: 'rust',
                currency: 'USD', 
                limit: PAGE_LIMIT.toString(),
            };
            if (cursor) { 
                queryParams.cursor = cursor;
            }
            
            const data = await callDMarketAPI('/exchange/v1/market/items', queryParams);

            if (data && data.objects && data.objects.length > 0) {
                totalFetched += data.objects.length;
                console.log(` -> Fetched ${data.objects.length} items this page.`);
                data.objects.forEach(item => {
                    if (item.title && !allSkins.has(item.title)) {
                        allSkins.set(item.title, {
                            name: item.title,
                            market_hash_name: item.title, // Use title as market_hash_name for now
                            icon_url: item.image || null, // Store image URL if available
                            // type: Could potentially parse from item.extra.categoryPath if needed
                        });
                    }
                });
                cursor = data.cursor; // Get the cursor for the next page
            } else {
                console.log(' -> No more items found on this page or empty response.');
                cursor = ''; // Stop the loop if no items or error
            }

            if (cursor) {
                console.log(`Waiting ${DELAY_MS}ms before next page...`);
                await sleep(DELAY_MS);
            }

        } while (cursor); // Continue as long as there's a cursor for the next page

        console.log(`\nFinished fetching from DMarket. Total items checked: ${totalFetched}. Unique skins found: ${allSkins.size}`);

        if (allSkins.size > 0) {
            const skinsToInsert = Array.from(allSkins.values());
            console.log(`Attempting to insert/update ${skinsToInsert.length} skins into Supabase...`);

            // Insert into Supabase in chunks to avoid large payload issues
            const chunkSize = 100;
            for (let i = 0; i < skinsToInsert.length; i += chunkSize) {
                const chunk = skinsToInsert.slice(i, i + chunkSize);
                console.log(` - Inserting chunk ${i / chunkSize + 1}...`);
                const { error: insertError } = await supabase
                    .from('skins')
                    .upsert(chunk, { onConflict: 'market_hash_name' }); // Insert or do nothing if market_hash_name exists
                    // Note: Using market_hash_name as conflict target assumes it's unique

                if (insertError) {
                    console.error(`Error inserting chunk ${i / chunkSize + 1}:`, insertError);
                    // Decide if you want to stop or continue on error
                } else {
                     console.log(` -> Chunk ${i / chunkSize + 1} inserted successfully.`);
                }
                await sleep(100); // Small delay between db operations
            }
            console.log('Supabase insert process finished.');
        } else {
            console.log('No new unique skins found to insert.');
        }

    } catch (error) {
        console.error('\n--- An error occurred during the population process --- ');
        // Error already logged in callDMarketAPI or during DB insert
    }
}

// Run the function
populateSkins(); 