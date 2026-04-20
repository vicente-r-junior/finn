import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  return new OpenAI({ apiKey })
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename = 'audio.ogg'
): Promise<string> {
  const openai = getOpenAI()
  const file = new File([audioBuffer], filename, { type: 'audio/ogg' })

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    // no language lock — Whisper auto-detects PT-BR, EN, and others
  })

  return response.text
}

export async function parseImage(imageUrlOrBase64: string): Promise<string> {
  const openai = getOpenAI()

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract ALL financial information from this image: amounts, descriptions, dates, merchant names. Return as plain text.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrlOrBase64, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 1000,
  })

  return response.choices[0]?.message?.content ?? ''
}

export async function parsePdf(pdfBuffer: Buffer): Promise<string> {
  const result = await pdfParse(pdfBuffer)
  return result.text
}

export async function processMedia(
  mediaType: 'text' | 'audio' | 'image' | 'pdf',
  content: string | Buffer
): Promise<string> {
  switch (mediaType) {
    case 'text':
      return content as string
    case 'audio':
      return transcribeAudio(content as Buffer)
    case 'image':
      return parseImage(content as string)
    case 'pdf':
      return parsePdf(content as Buffer)
    default:
      return content as string
  }
}
