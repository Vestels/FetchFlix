const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-cli');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const videoRegex = /https?:\/\/(?:www\.)?(facebook\.com\/(?:watch\/\?v=|username\/videos\/|video\.php\?v=|share\/(?:r|v)\/|videos\/\w+|[\d]+\/videos\/[\d]+(?:\?__so__=permalink)?)|instagram\.com\/(?:reel\/|p\/|USERNAME\/media\/))([\w-]+)/i;

const specialUserId = '373834322379014146';
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}

function clearVideosDirectory() {
  fs.readdir(videosDir, (err, files) => {
    if (err) {
      console.error('Error reading the videos directory:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(videosDir, file);
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Failed to delete video file: ${filePath}`, err);
        } else {
          console.log(`Deleted video file: ${filePath}`);
        }
      });
    });
  });
}

async function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.run(`-i ${inputPath} -vcodec libx264 -crf 28 ${outputPath}`)
      .then(() => {
        console.log('Video compression finished.');
        resolve();
      })
      .catch((err) => {
        console.error('Compression error:', err);
        reject(err);
      });
  });
}

function getFileSizeInMegabytes(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size / (1024 * 1024);
}

async function downloadVideo(interaction, videoUrl) {
  await interaction.reply('Processing your request...');

  clearVideosDirectory();

  const options = {
    method: 'GET',
    url: process.env.API_BASE_URL,
    params: { url: videoUrl },
    headers: {
      'x-rapidapi-key': process.env.KEY,
      'x-rapidapi-host': process.env.HOST
    }
  };

  try {
    const response = await axios.request(options);
    const videoDownloadUrl = response.data.links[1].link;
    const videoResponse = await axios({
      method: 'GET',
      url: videoDownloadUrl,
      responseType: 'stream'
    });

    const originalFilePath = path.join(videosDir, `downloaded_video_${interaction.id}.mp4`);
    const compressedFilePath = path.join(videosDir, `compressed_video_${interaction.id}.mp4`);

    const writer = fs.createWriteStream(originalFilePath);
    videoResponse.data.pipe(writer);

    writer.on('finish', async () => {
      console.log('Video successfully downloaded!');

      const fileSizeInMB = getFileSizeInMegabytes(originalFilePath);
      const thresholdSize = 8;

      if (fileSizeInMB > thresholdSize) {
        await interaction.editReply('🚨 **The video is too large!** Compressing...');

        try {
          await compressVideo(originalFilePath, compressedFilePath);
          await interaction.editReply({ content: 'Your video is ready!', files: [compressedFilePath] });
          fs.unlinkSync(originalFilePath);
          fs.unlinkSync(compressedFilePath);
          console.log(`Deleted video files after sending: ${originalFilePath} and ${compressedFilePath}`);
        } catch (error) {
          console.error('Error during compression:', error);
          await interaction.editReply('❌ Error during video compression. **The compressed file is probably too large to send.**');
        }
      } else {
        await interaction.editReply({ content: 'Your video is ready!', files: [originalFilePath] });
        fs.unlinkSync(originalFilePath);
        console.log(`Deleted video file after sending: ${originalFilePath}`);
      }

      if (interaction.user.id === specialUserId) {
        await interaction.followUp('A kurva anyádat Szlöfety.');
      }
    });

    writer.on('error', async (err) => {
      console.error('Error during downloading the video:', err);
      await interaction.editReply('❌ **Error during downloading the video.** Try again!');
    });

  } catch (error) {
    console.error('Error:', error);
    await interaction.editReply('❌ Something went wrong. **Check the URL again!**');
  }
}

async function registerCommands(guildId) {
  const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);
  
  try {
    const existingCommands = await rest.get(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId));
    await Promise.all(existingCommands.map(command => {
      return rest.delete(Routes.applicationGuildCommand(process.env.DISCORD_CLIENT_ID, guildId, command.id));
    }));
    console.log('Successfully deleted existing commands.');
  } catch (error) {
    console.error('Error deleting existing commands:', error);
  }

  try {
    console.log('Started registering application (/) commands.');
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), {
      body: [
        {
          name: 'link',
          description: 'Send a video link',
          options: [{
            type: 3,
            name: 'url',
            description: 'The video URL',
            required: true,
          }],
        },
      ],
    });
    console.log('Successfully registered application commands.');
  } catch (error) {
    console.error('Error registering application commands:', error);
  }
}

client.on('guildCreate', async (guild) => {
  console.log(`Bot joined a new guild: ${guild.name} (ID: ${guild.id})`);
  await registerCommands(guild.id);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'link') {
    const url = options.getString('url');
    console.log(`Processing link: ${url}`);

    if (!videoRegex.test(url)) {
      await interaction.reply('❌ **Invalid URL!** Please provide a valid video link.');
      return;
    }

    await downloadVideo(interaction, url);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);