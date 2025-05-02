// Load environment variables from .env file
require('dotenv').config();

// Import necessary discord.js classes
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { startAlertChecker } = require('./tasks/alertChecker'); // Import the checker
const http = require('http'); // Import the http module
const supabase = require('./supabaseClient'); // Import Supabase client (Reverted path)

console.log('Bot is starting...');

// --- Express Web Server Setup (for Render health checks) ---
// const app = express();
// // Render provides the PORT environment variable
// const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev
//
// // Basic route for health checks
// app.get('/', (req, res) => {
//   // Respond to indicate the bot process is running
//   res.status(200).send('Rust Skin Bot is alive!'); 
// });
//
// app.listen(port, () => {
//   console.log(`[WebServer] Listening on port ${port} for health checks.`);
// });
// --- End Express Setup ---

// Check if the bot token is available
// const token = process.env.DISCORD_BOT_TOKEN; // This was redundant
// if (!token) {
//     console.error("Error: DISCORD_BOT_TOKEN not found in .env file.");
//     process.exit(1); // Exit the process if the token is missing
// }

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
    console.log(`Ready! Logged in as ${client.user.tag}`);
    startAlertChecker(client); // Start the alert checking loop
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
        // Check if interaction is still valid before replying
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
	}
});
// --- End Interaction Handling ---

// Log in to Discord with your client's token
console.log('[Login] Attempting client.login()...');
// Ensure we use DISCORD_TOKEN (or whatever is in your .env)
const discordToken = process.env.DISCORD_TOKEN; 
if (!discordToken) {
    console.error("Error: DISCORD_TOKEN not found in .env file.");
    process.exit(1);
}

client.login(discordToken)
    .then(() => console.log('[Login] Successfully logged in.'))
    .catch(error => {
        console.error('[Login] Failed to log in:', error);
        // Added detailed logging for common intent issues
        if (error.code === 'DisallowedIntents') {
            console.error('[Login] Error: DisallowedIntents. Please ensure all necessary intents (Guilds, GuildMessages, MessageContent, DirectMessages) are enabled in your bot\'s application settings on the Discord Developer Portal.');
        }
        process.exit(1); // Exit if login fails
    });

// --- Render Health Check Server ---
const PORT = process.env.PORT || 10000; // Use Render's port or default to 10000
const server = http.createServer((req, res) => { // Store server instance
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

server.listen(PORT, () => {
    console.log(`[WebServer] Listening on port ${PORT} for health checks.`);
});
// --- End Render Health Check Server ---

// Optional: Graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`${signal} signal received: closing HTTP server and Discord client.`);
    server.close(() => { // Close HTTP server first
        console.log('HTTP server closed.');
        client.destroy(); // Then close Discord connection
        console.log('Discord client destroyed.');
        process.exit(0);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Basic error handling
client.on('error', err => {
    console.error('[Client Error] Discord client emitted error:', err);
});

// Keep the placeholder comment or remove it
// TODO: Add event handlers, command registration, API interaction, etc. 