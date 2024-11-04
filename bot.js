const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const videoRegex = /https?:\/\/(?:www\.)?(facebook\.com\/(?:watch\?v=\d+|username\/videos\/|video\.php\?v=|share\/(?:r|v)\/|videos\/\w+|[\d]+\/videos\/[\d]+|reel\/[\d]+(?:\?s=[\w-]+)?(?:&fs=[\w-]+)?|reel\/\w+)|fb\.watch\/[\w-]+|instagram\.com\/(?:reel\/|p\/|USERNAME\/media\/))/i;

const specialUserId = '373834322379014146';
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}

async function cleanOldVideos() {
  const currentTime = Date.now();
  const expirationTime = (10 * 60) * 1000;

  fs.readdir(videosDir, (err, files) => {
    if (err) {
      console.error('Error reading the videos directory:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(videosDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error('Error getting file stats:', err);
          return;
        }

        const fileAge = currentTime - stats.mtimeMs;
        if (fileAge > expirationTime) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Failed to delete old video file: ${filePath}`, err);
            } else {
              console.log(`Deleted old video file: ${filePath}`);
            }
          });
        }
      });
    });
  });
}

async function checkIfAudioOnly(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error checking if file is audio-only:', err);
        return reject(err);
      }
      
      const hasVideoStream = metadata.streams.some(stream => stream.codec_type === 'video');
      resolve(!hasVideoStream);
    });
  });
}

async function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('Compression took too long and was aborted.');
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(new Error('Compression took too long.'));
    }, 60000);

    ffmpeg(inputPath)
      .videoCodec('libx264')
      .outputOptions('-crf 28')
      .save(outputPath)
      .on('end', () => {
        clearTimeout(timeout);
        console.log('Video compression finished.');
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeout);
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
  await interaction.deferReply(); // Az interakció elhalasztása

  await cleanOldVideos();

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

      if (!fs.existsSync(originalFilePath)) {
        await interaction.editReply('❌ **The downloaded video file does not exist.**');
        return;
      }

      const isAudioOnly = await checkIfAudioOnly(originalFilePath);
      if (isAudioOnly) {
        await interaction.editReply('❌ **The video is likely to be private or marked as adult content.**');
        fs.unlinkSync(originalFilePath);
        return;
      }

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
          if (fs.existsSync(originalFilePath)) fs.unlinkSync(originalFilePath);
          if (fs.existsSync(compressedFilePath)) fs.unlinkSync(compressedFilePath);
          if (error.message === 'Compression took too long.') {
            await interaction.editReply('❌ **Compression took too long. The video file is likely too large to compress!**');
          } else {
            await interaction.editReply('❌ Error during video compression. **The compressed file is probably too large to send.**');
          }
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
      if (fs.existsSync(originalFilePath)) {
        fs.unlinkSync(originalFilePath);
      }
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
      await interaction.reply('❌ **Please provide a valid video link!**');
      return;
    }

    await downloadVideo(interaction, url);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);