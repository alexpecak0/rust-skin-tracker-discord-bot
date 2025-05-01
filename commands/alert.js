const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const supabase = require('../utils/supabaseClient'); // Import Supabase client

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alert')
        .setDescription('Manage price alerts for Rust skins.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new price alert.')
                .addStringOption(option =>
                    option.setName('skin_name')
                        .setDescription('The name of the skin to track.')
                        .setRequired(true))
                .addNumberOption(option =>
                    option.setName('price')
                        .setDescription('The target price (e.g., 5.50 for $5.50).')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('condition')
                        .setDescription('Alert when the price goes above or below the target?')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Below', value: 'below' },
                            { name: 'Above', value: 'above' }
                        )))
        // --- Add list subcommand --- 
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List your active price alerts.'))
        // --- Add remove subcommand ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an active price alert.')
                .addIntegerOption(option => // Use integer for the ID
                    option.setName('alert_id')
                        .setDescription('The ID of the alert to remove (get from /alert list).' )
                        .setRequired(true)))
        ,
    async execute(interaction) {
        // Defer reply - Ephemeral so only user sees confirmation/errors
        await interaction.deferReply({ ephemeral: true });

        if (!supabase) {
            return await interaction.editReply('Error: Could not connect to the database.');
        }

        const subcommand = interaction.options.getSubcommand();

        // --- Handle 'add' subcommand ---
        if (subcommand === 'add') {
            const skinNameInput = interaction.options.getString('skin_name');
            const targetPrice = interaction.options.getNumber('price');
            const condition = interaction.options.getString('condition');
            const userId = interaction.user.id;

            // Validate price
            if (targetPrice <= 0) {
                return await interaction.editReply('Invalid price. Please enter a price greater than 0.');
            }

            try {
                // 1. Find the skin in the database
                const { data: skinData, error: skinError } = await supabase
                    .from('skins')
                    .select('id, name') // Select id and name
                    .ilike('name', `%${skinNameInput}%`)
                    .limit(1) // Limit to one match
                    .single(); // Expect single row or null

                if (skinError && skinError.code !== 'PGRST116') { // Ignore "0 rows" error
                    console.error('Error fetching skin for alert:', skinError);
                    return await interaction.editReply('An error occurred searching for the skin.');
                }

                if (!skinData) {
                    return await interaction.editReply(`Could not find a skin matching "${skinNameInput}". Please be more specific.`);
                }

                const skinId = skinData.id;
                const foundSkinName = skinData.name;

                // 2. Insert the alert into the database
                const { error: insertError } = await supabase
                    .from('alerts')
                    .insert({
                        user_discord_id: userId,
                        skin_id: skinId,
                        target_price: targetPrice,
                        alert_condition: condition,
                        // is_active defaults to true, created_at defaults to now()
                    });

                if (insertError) {
                    console.error('Error inserting alert:', insertError);
                    // Check for unique constraint violation (user already has alert for this skin?)
                    // Consider adding a UNIQUE constraint on (user_discord_id, skin_id) in Supabase for this check
                    if (insertError.code === '23505') { // unique_violation
                         return await interaction.editReply(`You might already have an active alert for **${foundSkinName}**. Use \`/alert list\` to check.`);
                    }
                    return await interaction.editReply('Failed to save the alert. Please try again.');
                }

                // 3. Confirm to user
                await interaction.editReply(`✅ Alert set! I will notify you if **${foundSkinName}** goes **${condition}** $${targetPrice.toFixed(2)}.`);

            } catch (error) {
                console.error('Error processing /alert add:', error);
                await interaction.editReply('An unexpected error occurred while setting the alert.');
            }
        }
        // --- Handle 'list' subcommand --- 
        else if (subcommand === 'list') {
            const userId = interaction.user.id;
            try {
                // Fetch alerts for the user, joining with skins table to get names
                // Need to explicitly select columns from both tables
                const { data: alerts, error } = await supabase
                    .from('alerts')
                    .select(`
                        id, 
                        target_price, 
                        alert_condition,
                        skins ( name ) 
                    `)
                    .eq('user_discord_id', userId)
                    .eq('is_active', true);

                if (error) {
                    console.error('Error fetching alerts:', error);
                    return await interaction.editReply('Could not fetch your alerts.');
                }

                if (!alerts || alerts.length === 0) {
                    return await interaction.editReply('You have no active alerts set. Use `/alert add` to create one!');
                }

                // Format the response
                const embed = new EmbedBuilder()
                    .setTitle('Your Active Alerts')
                    .setColor(0x00FF00)
                    .setTimestamp();
                
                let description = 'Here are your active price alerts:\n\n';
                alerts.forEach(alert => {
                    const skinName = alert.skins.name || 'Unknown Skin'; // Access nested skin name
                    const condition = alert.alert_condition === 'below' ? '<' : '>';
                    description += `**ID:** ${alert.id} - **${skinName}** ${condition} **$${alert.target_price.toFixed(2)}**\n`;
                });
                description += '\nUse `/alert remove alert_id:<ID>` to remove an alert.';
                embed.setDescription(description);

                await interaction.editReply({ embeds: [embed] });

            } catch (error) {
                console.error('Error processing /alert list:', error);
                await interaction.editReply('An unexpected error occurred while listing alerts.');
            }
        }
        // --- Handle 'remove' subcommand --- 
        else if (subcommand === 'remove') {
            const userId = interaction.user.id;
            const alertIdToRemove = interaction.options.getInteger('alert_id');

            if (alertIdToRemove <= 0) {
                 return await interaction.editReply('Invalid Alert ID.');
            }

            try {
                // Attempt to delete the alert matching the ID AND the user ID
                const { count, error } = await supabase
                    .from('alerts')
                    .delete()
                    .eq('id', alertIdToRemove)
                    .eq('user_discord_id', userId); // Ensure user owns the alert
                    
                // Note: .delete() in Supabase v2+ doesn't directly return count reliably without .select()
                // We infer success based on lack of error for now, could be improved.
                // A better check would be if Supabase JS Client v3 allows returning count/data.

                if (error) {
                    console.error('Error removing alert:', error);
                    return await interaction.editReply('Could not remove the alert. Please check the ID and try again.');
                }

                // Simplified check: If no error, assume it worked or didn't exist/belong to user
                // A check on 'count' would be better if available and reliable
                // if (count === 0) {
                //     await interaction.editReply(`Could not find alert with ID ${alertIdToRemove} belonging to you.`);
                // } else {
                //     await interaction.editReply(`✅ Alert ID ${alertIdToRemove} has been removed.`);
                // }
                await interaction.editReply(`✅ Attempted to remove alert ID ${alertIdToRemove}. If it existed and belonged to you, it has been removed.`);

            } catch (error) {
                console.error('Error processing /alert remove:', error);
                await interaction.editReply('An unexpected error occurred while removing the alert.');
            }
        }
         // --- Fallback for any other subcommands ---
        else {
            await interaction.editReply('This alert subcommand is not yet implemented.');
        }
    },
};