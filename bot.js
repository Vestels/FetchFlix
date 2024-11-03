const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-cli');
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

async function downloadVideo(message, videoUrl) {
  const loadingMessage = await message.reply('Processing your request...');
  let loadingDots = 0;

  const updateLoadingMessage = setInterval(async () => {
    loadingDots = (loadingDots + 1) % 4;
    const dots = '.'.repeat(loadingDots);
    await loadingMessage.edit(`Processing your request${dots}`);
  }, 500);

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

    const originalFilePath = path.join(videosDir, `downloaded_video_${message.id}.mp4`);
    const compressedFilePath = path.join(videosDir, `compressed_video_${message.id}.mp4`);

    if (fs.existsSync(originalFilePath)) {
      fs.unlinkSync(originalFilePath);
      console.log(`Deleted existing video file: ${originalFilePath}`);
    }

    const writer = fs.createWriteStream(originalFilePath);
    videoResponse.data.pipe(writer);

    writer.on('finish', async () => {
      clearInterval(updateLoadingMessage);
      console.log('Video successfully downloaded!');

      const fileSizeInMB = getFileSizeInMegabytes(originalFilePath);
      const thresholdSize = 8;

      if (fileSizeInMB > thresholdSize) {
        loadingDots = 0;
        const compressLoadingMessage = await loadingMessage.edit('🚨 **The video is too large!** Compressing...');
        const updateCompressMessage = setInterval(async () => {
          loadingDots = (loadingDots + 1) % 4;
          const dots = '.'.repeat(loadingDots);
          await compressLoadingMessage.edit(`🚨 **The video is too large!** Compressing${dots}`);
        }, 500);

        try {
          await compressVideo(originalFilePath, compressedFilePath);
          clearInterval(updateCompressMessage);
          await loadingMessage.edit({ content: 'Your video is ready!', files: [compressedFilePath] });
          fs.unlinkSync(originalFilePath);
          fs.unlinkSync(compressedFilePath);
          console.log(`Deleted video files after sending: ${originalFilePath} and ${compressedFilePath}`);
        } catch (error) {
          clearInterval(updateCompressMessage);
          console.error('Error during compression:', error);
          await loadingMessage.edit('❌ Error during video compression. **The compressed file is probably too large to send.**');
        }
      } else {
        await loadingMessage.edit({ content: 'Your video is ready!', files: [originalFilePath] });
        fs.unlinkSync(originalFilePath);
        console.log(`Deleted video file after sending: ${originalFilePath}`);
      }

      if (message.author.id === specialUserId) {
        await message.reply('A kurva anyádat Szlöfety.');
      }
    });

    writer.on('error', async (err) => {
      clearInterval(updateLoadingMessage);
      console.error('Error during downloading the video:', err);
      await loadingMessage.edit('❌ Error during downloading the video. **Try again!**');
    });

  } catch (error) {
    clearInterval(updateLoadingMessage);
    console.error('Error:', error);
    await loadingMessage.edit('❌ Something went wrong. **Check the URL again!**');
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const foundLinks = message.content.match(videoRegex);
  if (foundLinks) {
    const videoUrl = foundLinks[0];
    console.log(`Found a video link: ${videoUrl}`);
    downloadVideo(message, videoUrl);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);