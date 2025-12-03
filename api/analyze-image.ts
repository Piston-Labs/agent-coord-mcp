import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messageId, imageData: directImageData, prompt } = req.body;
    
    let imageData: string | null = null;
    let imageName: string = 'uploaded-image';

    // If messageId provided, fetch image from chat message
    if (messageId) {
      const messages = await redis.lrange(MESSAGES_KEY, 0, 999);
      const parsedMessages = messages.map((m: any) => typeof m === 'string' ? JSON.parse(m) : m);
      const targetMessage = parsedMessages.find((m: any) => m.id === messageId);
      
      if (!targetMessage) {
        return res.status(404).json({ error: 'Message not found' });
      }
      
      if (!targetMessage.imageData) {
        return res.status(400).json({ error: 'Message has no image attached' });
      }
      
      imageData = targetMessage.imageData;
      imageName = targetMessage.imageName || 'chat-image';
    } else if (directImageData) {
      imageData = directImageData;
    }

    if (!imageData) {
      return res.status(400).json({ error: 'messageId or imageData required' });
    }

    // Extract base64 data and media type
    const matches = imageData.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image data format' });
    }
    
    const mediaType = matches[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = matches[2];

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'Image analysis not configured',
        details: 'ANTHROPIC_API_KEY environment variable is not set. Please add it to Vercel environment variables.',
        setup: 'Go to Vercel Dashboard → Settings → Environment Variables → Add ANTHROPIC_API_KEY'
      });
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Call Claude vision API
    const analysisPrompt = prompt || 'Analyze this image. Describe what you see in detail, including any text, objects, UI elements, or relevant information.';
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: analysisPrompt,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textContent = response.content.find(c => c.type === 'text');
    const analysis = textContent ? textContent.text : 'No analysis available';


    return res.json({
      success: true,
      messageId: messageId || null,
      imageName,
      analysis,
      model: 'claude-sonnet-4-20250514',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Image analysis error:', error);
    return res.status(500).json({ 
      error: 'Image analysis failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
}
