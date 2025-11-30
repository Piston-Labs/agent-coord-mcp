import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface AnalyzeRequest {
  imageData: string; // base64 data URL (data:image/png;base64,...)
  prompt?: string; // Optional custom prompt for analysis
  context?: string; // Optional context about what to look for
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData, prompt, context } = req.body as AnalyzeRequest;

    if (!imageData) {
      return res.status(400).json({ error: 'imageData is required (base64 data URL)' });
    }

    // Validate image format
    if (!imageData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format. Must be base64 data URL (data:image/...)' });
    }

    // Extract media type and base64 data
    const matches = imageData.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid base64 image format' });
    }

    const mediaType = matches[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = matches[2];

    // Validate supported media types
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!supportedTypes.includes(mediaType)) {
      return res.status(400).json({
        error: `Unsupported image type: ${mediaType}. Supported: ${supportedTypes.join(', ')}`
      });
    }

    // Build the analysis prompt
    let analysisPrompt = prompt || 'Please analyze this image and provide a detailed description. Include:';
    if (!prompt) {
      analysisPrompt += `
1. What is shown in the image (objects, people, text, UI elements, etc.)
2. Any text visible in the image (transcribe it)
3. Key details that would help someone understand the context
4. If it's a screenshot, describe the application/interface shown`;
    }

    if (context) {
      analysisPrompt += `\n\nAdditional context: ${context}`;
    }

    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
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

    // Extract the text response
    const textContent = response.content.find(c => c.type === 'text');
    const analysis = textContent ? textContent.text : 'No analysis generated';

    return res.json({
      success: true,
      analysis,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Image analysis error:', error);

    // Handle specific Anthropic errors
    if (error instanceof Anthropic.APIError) {
      return res.status(error.status || 500).json({
        error: 'API error',
        message: error.message,
        code: error.status,
      });
    }

    return res.status(500).json({
      error: 'Server error',
      details: String(error)
    });
  }
}
