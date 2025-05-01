const { SlashCommandBuilder } = require('discord.js');
const supabase = require('../utils/supabaseClient'); // Import the Supabase client
const axios = require('axios'); // Import axios for HTTP requests
const crypto = require('node:crypto'); // Import crypto for signing

// DMarket Keys (ensure these are loaded from process.env)
const dmarketPublicKey = process.env.DMARKET_PUBLIC_KEY;
const dmarketSecretKey = process.env.DMARKET_SECRET_KEY;

// --- Simple In-Memory Cache ---
const priceCache = new Map();
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

module.exports = {
    data: new SlashCommandBuilder()
        .setName('price')
        .setDescription('Fetches the price for a specific Rust skin from DMarket.')
        .addStringOption(option =>
            option.setName('skin_name')
                .setDescription('The name of the skin to look up')
                .setRequired(true)),
    async execute(interaction) {
        const skinNameInput = interaction.options.getString('skin_name');
        
        await interaction.deferReply({ ephemeral: false });

        // Wrap the entire process in a single try...catch
        try {
            // --- Pre-checks ---
            if (!supabase) {
                console.error('Supabase client is not initialized.');
                return await interaction.editReply('Error: Could not connect to the database.');
            }
            if (!dmarketPublicKey || !dmarketSecretKey) {
                 console.error('DMarket API keys missing from .env');
                 return await interaction.editReply('Error: Bot is missing necessary configuration for DMarket.');
            }

            // --- 1. Get Skin Data from Supabase ---
            const { data: skinData, error: dbError } = await supabase
                .from('skins')
                .select('name, market_hash_name') // Still use market_hash_name for DMarket query
                .ilike('name', `%${skinNameInput}%`)
                .limit(1)
                .single();

            if (dbError && dbError.code !== 'PGRST116') { // Handle specific DB errors
                console.error('Supabase query error:', dbError);
                return await interaction.editReply('An error occurred while searching for the skin.');
            }
            if (!skinData) { // Handle skin not found
                return await interaction.editReply(`Could not find a skin matching "${skinNameInput}" in the database.`);
            }
            console.log(`Found skin: ${skinData.name}, Market Hash: ${skinData.market_hash_name}`);
            const foundSkinName = skinData.name; // Use the name found in DB as cache key

            // --- Check Cache --- 
            if (priceCache.has(foundSkinName)) {
                const cacheEntry = priceCache.get(foundSkinName);
                if (Date.now() - cacheEntry.timestamp < CACHE_DURATION_MS) {
                    console.log(`[Cache] HIT for ${foundSkinName}`);
                    livePrice = cacheEntry.price;
                    // Skip DMarket fetch, jump straight to reply
                    await interaction.editReply(`Found: **${foundSkinName}**\nMarket Name: \`${skinData.market_hash_name}\`\nPrice (DMarket - Cached): **${livePrice}**`); // Indicate cached price
                    return; // Exit early
                } else {
                    console.log(`[Cache] STALE for ${foundSkinName}`);
                    priceCache.delete(foundSkinName); // Remove stale entry
                }
            } else {
                console.log(`[Cache] MISS for ${foundSkinName}`);
            }
            // --- End Cache Check ---

            // --- 2. Fetch Live Price from DMarket (if not cached) ---
            livePrice = 'Error fetching price.'; // Reset default for fetch
            try { // Inner try...catch specifically for the DMarket API call
                const method = 'GET';
                const apiPath = '/exchange/v1/market/items';
                const queryParams = new URLSearchParams({
                    gameId: 'rust',
                    currency: 'USD',
                    title: skinData.name,
                    limit: '5' 
                }).toString();
                
                const host = 'https://api.dmarket.com';
                const url = `${host}${apiPath}?${queryParams}`;
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const stringToSign = `${method}${apiPath}?${queryParams}${timestamp}`;

                const signature = crypto
                    .createHmac('sha256', dmarketSecretKey)
                    .update(stringToSign)
                    .digest('hex');

                console.log(`Fetching DMarket price from: ${url}`);

                const response = await axios.get(url, {
                    headers: {
                        'X-Api-Key': dmarketPublicKey,
                        'X-Request-Sign': `dmar_${signature}`,
                        'X-Sign-Timestamp': timestamp,
                        'Content-Type': 'application/json' 
                    },
                    timeout: 10000
                });

                if (response.data && response.data.objects && response.data.objects.length > 0) {
                    const offers = response.data.objects;
                    offers.sort((a, b) => parseFloat(a.price.USD) - parseFloat(b.price.USD));
                    const lowestPriceCents = parseFloat(offers[0].price.USD);
                    livePrice = `$${(lowestPriceCents / 100).toFixed(2)}`;
                    
                    // --- Update Cache ---
                    priceCache.set(foundSkinName, { price: livePrice, timestamp: Date.now() });
                    console.log(`[Cache] SET for ${foundSkinName}`);
                    // --- End Update Cache ---
                    
                } else {
                    console.warn('No items found or empty response from DMarket:', response.data);
                    livePrice = 'Not found on DMarket.';
                }

            } catch (fetchError) { // Catch errors specifically from the DMarket fetch
                console.error('Error fetching price from DMarket:', fetchError.message);
                if (fetchError.response) {
                    console.error('DMarket API Response Status:', fetchError.response.status);
                    console.error('DMarket API Response Data:', fetchError.response.data);
                    livePrice = `Error: ${fetchError.response.status} from DMarket.`;
                } else if (fetchError.request) {
                    console.error('DMarket request made but no response received.');
                    livePrice = 'Error: No response from DMarket.';
                } else {
                    livePrice = 'Error setting up DMarket request.';
                }
                // Assign error message to livePrice but continue to the reply
            }

            // --- 3. Reply to User (if not replied with cached data) ---            
            await interaction.editReply(`Found: **${foundSkinName}**\nMarket Name: \`${skinData.market_hash_name}\`\nPrice (DMarket): **${livePrice}**`);

        } catch (error) { // Outer catch for any unexpected errors in the whole process
            console.error('Unexpected error executing price command:', error);
            // Check if the reply was already sent or deferred before trying to edit/reply again
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true });
            } else if (!interaction.replied) {
                await interaction.editReply('An unexpected error occurred while processing your request.');
            } // Avoid further errors if already replied
        }
    }, // Added comma here
};