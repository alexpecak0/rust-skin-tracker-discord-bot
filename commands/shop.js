const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const SHOP_URL = 'https://store.steampowered.com/itemstore/252490/ajaxgetitemdefs?filter=Limited&json=1';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Displays the current items in the official Rust Item Store.'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            console.log(`Fetching shop data from: ${SHOP_URL}`);
            const response = await axios.get(SHOP_URL, { timeout: 10000 });

            if (!response.data || response.data.success !== 1 || !response.data.matches || response.data.matches.length === 0) {
                console.warn('Failed to get valid shop data:', response.data);
                await interaction.editReply('Could not retrieve current shop items. The store might be empty or there was an error.');
                return;
            }

            const items = response.data.matches;

            // Edit the initial reply to confirm items are being listed
            await interaction.editReply(`Found ${items.length} items in the Rust Item Store. Listing them now:`);

            // Loop and send a separate embed for each item
            for (const item of items) {
                const name = item.strName || 'Unknown Item';
                const price = item.strFormattedFinalPrice || 'N/A';
                const imageUrl = item.strImgURL;
                // Add a default description if needed, or parse from strDescription
                // const description = item.strDescription ? item.strDescription.replace(/\/g, '').replace(/\[color=#[^]]+\]/g, '').replace(/\[\/color\]/g, '') : 'No description available.';

                const itemEmbed = new EmbedBuilder()
                    .setColor(0x0099FF) // Or use item.strNameColor if available and valid hex
                    .setTitle(name)
                    .addFields({ name: 'Price', value: `**${price}**`, inline: true })
                    // .setDescription(description) // Optional: add description
                    .setTimestamp();
                
                if (imageUrl) {
                    itemEmbed.setImage(imageUrl);
                }

                // Send as a follow-up message
                await interaction.followUp({ embeds: [itemEmbed] });
                
                // Optional: Add a small delay to prevent potential rate limits if shop is huge
                // await new Promise(resolve => setTimeout(resolve, 250)); 
            }

        } catch (error) {
            console.error('Error fetching or processing shop data:', error.message);
            if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            } else if (error.request) {
                 console.error('Request made but no response received');
            }
             
            // Check if the initial reply was already edited before trying again
            // Avoid editing reply if we already sent follow-ups
            if (interaction.channel) { // Check if interaction still valid
                try {
                    const initialReply = await interaction.fetchReply();
                    if (initialReply.content.includes('Listing them now')) { 
                        // If initial reply hasn't been edited beyond the confirmation, edit with error
                         await interaction.editReply('An error occurred while fetching shop data. Please try again later.');
                    } // Otherwise, assume followups might have started, don't edit again.
                } catch (editError) {
                    console.error("Failed to edit initial reply with error message:", editError);
                    // Fallback if editing fails
                     try {
                        await interaction.followUp({ content: 'An unexpected error occurred fetching shop data.', ephemeral: true });
                     } catch (followUpError) {
                        console.error("Failed to send follow-up error message:", followUpError);
                     }
                }
            }
        }
    },
}; 