import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

export async function decryptPdf(buffer: Buffer, passwords: string[] = ['21357', '']): Promise<Buffer> {
  // Check if qpdf is available
  const which = spawnSync('which', ['qpdf'], { encoding: 'utf8' })
  if (which.status !== 0) {
    // qpdf not found — return original buffer (might be unprotected)
    return buffer
  }

  const tmpIn = join(tmpdir(), `finn-pdf-in-${Date.now()}.pdf`)
  const tmpOut = join(tmpdir(), `finn-pdf-out-${Date.now()}.pdf`)

  try {
    writeFileSync(tmpIn, buffer)

    for (const password of passwords) {
      const args = [
        `--password=${password}`,
        '--decrypt',
        tmpIn,
        tmpOut,
      ]
      const result = spawnSync('qpdf', args, { encoding: 'utf8' })
      if (result.status === 0) {
        const decrypted = readFileSync(tmpOut)
        return decrypted
      }
    }

    // All passwords failed — return original buffer (might be unprotected)
    return buffer
  } finally {
    try { unlinkSync(tmpIn) } catch { /* ignore */ }
    try { unlinkSync(tmpOut) } catch { /* ignore */ }
  }
}

export async function parsePdf(pdfBuffer: Buffer): Promise<string> {
  const decrypted = await decryptPdf(pdfBuffer)
  const result = await pdfParse(decrypted)
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
