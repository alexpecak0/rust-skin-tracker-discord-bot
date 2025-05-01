const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config(); // Load .env variables

const clientId = process.env.DISCORD_CLIENT_ID; // You might need to add this to your .env file
const token = process.env.DISCORD_BOT_TOKEN;

if (!clientId || !token) {
    console.error('Error: DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN missing from .env');
    process.exit(1);
}

const commands = [];
// Grab all the command files from the commands directory you created earlier
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	if ('data' in command && 'execute' in command) {
		commands.push(command.data.toJSON());
        console.log(`[INFO] Loaded command ${command.data.name} from ${file}`);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
	console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

	// The put method is used to fully refresh all commands in the guild with the current set
	try {
		// Use the global application commands endpoint
		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error('Error deploying global commands:', error);
	}
})(); 