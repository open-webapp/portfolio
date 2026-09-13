import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

mkdirSync('public', { recursive: true })

const src = 'public/icon-source.svg'

await sharp(src).resize(192, 192).png().toFile('public/icon-192.png')
await sharp(src).resize(512, 512).png().toFile('public/icon-512.png')
await sharp(src).resize(512, 512).png().toFile('public/icon-512-maskable.png')
await sharp(src).resize(32, 32).png().toFile('public/favicon-32.png')
