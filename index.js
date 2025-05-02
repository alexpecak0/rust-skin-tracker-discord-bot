// Load environment variables from .env file
require('dotenv').config();

// Import necessary discord.js classes
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { startAlertChecker } = require('./tasks/alertChecker'); // Import the checker
const express = require('express'); // Require Express

console.log('Bot is starting...');

// --- Express Web Server Setup (for Render health checks) ---
const app = express();
// Render provides the PORT environment variable
const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev

// Basic route for health checks
app.get('/', (req, res) => {
  // Respond to indicate the bot process is running
  res.status(200).send('Rust Skin Bot is alive!'); 
});

app.listen(port, () => {
  console.log(`[WebServer] Listening on port ${port} for health checks.`);
});
// --- End Express Setup ---

// Check if the bot token is available
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error("Error: DISCORD_BOT_TOKEN not found in .env file.");
    process.exit(1); // Exit the process if the token is missing
}

// Create a new client instance with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,          // Required for basic server functionality
        GatewayIntentBits.GuildMessages,   // Required to receive messages in guilds
        GatewayIntentBits.MessageContent   // Required to read message content (ensure enabled in Developer Portal!)
        // Add other intents as needed, e.g., GatewayIntentBits.GuildMembers for member tracking
    ]
});

// --- Command Loading --- 
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`[INFO] Loaded command ${command.data.name}`);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}
// --- End Command Loading ---

// When the client is ready, run this code (only once)
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready!');

    // Start the alert checker loop, passing the client instance
    startAlertChecker(client, 5); // Check every 5 minutes (adjust interval as needed)
});

// --- Interaction Handling ---
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return; // Only handle slash commands

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
        await interaction.reply({ content: 'Error: Command not found.', ephemeral: true });
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error('Error executing command:', error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});
// --- End Interaction Handling ---

// Log in to Discord with your client's token
if (token) {
    console.log('[Login] Attempting client.login()...'); // Log before calling login
    client.login(token)
        .then(() => {
            console.log('[Login] client.login() promise resolved.'); // Log on successful promise resolution (before 'ready')
        })
        .catch(err => {
            console.error('[Login] client.login() promise rejected:', err); // Log detailed error on rejection
        });
} else {
    console.error('ERROR: DISCORD_BOT_TOKEN is not set in the .env file!');
    process.exit(1); // Exit if token is missing
}

// Basic error handling
client.on('error', err => {
    console.error('[Client Error] Discord client emitted error:', err);
});

// Keep the placeholder comment or remove it
// TODO: Add event handlers, command registration, API interaction, etc. 