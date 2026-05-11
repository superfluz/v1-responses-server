# v1-responses-server

Backend Express untuk meneruskan request client ke model endpoint yang kompatibel dengan `/v1/responses`, lalu mengirim hasil streaming ke client lewat Server-Sent Events (SSE).

## Struktur Project

```txt
src/
├─ server.js
├─ routes/
│  └─ route.js
├─ services/
│  └─ service.js
├─ utils/
│  └─ sse.js
└─ validators/
   └─ input.js
```

Pembagian file:

- `src/server.js`: entrypoint Express, middleware, health check, dan mount route.
- `src/routes/route.js`: route `/api/responses`, validasi request, orchestration, dan error handling.
- `src/services/service.js`: request ke model, parsing event SSE dari upstream, mapping event, dan stream handler.
- `src/utils/sse.js`: helper header dan sender SSE.
- `src/validators/input.js`: normalisasi input client.

## Setup

Install dependency:

```bash
npm install
```

Buat file `.env` dari contoh:

```bash
cp .env.example .env
```

Isi konfigurasi:

```env
API_KEY=isi_api_key_model_cloud_di_sini
MODEL_BASE_URL=http://localhost:11434
MODEL_NAME=gpt-oss:20b-cloud
CLIENT_ORIGINS=http://localhost:5007,http://127.0.0.1:5007,http://localhost:5507,http://127.0.0.1:5507
PORT=3000
```

Untuk model cloud, ganti `MODEL_BASE_URL` dan `MODEL_NAME` sesuai provider yang dipakai.

## Menjalankan Server

Production-style:

```bash
npm start
```

Development dengan `nodemon`:

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3000/
```

## Test Client HTML

Client statis tersedia di:

```txt
client/index.html
```

Jalankan client di port `5007`:

```bash
python -m http.server 5007 --directory client
```

Buka:

```txt
http://127.0.0.1:5007
```

Client mendukung:

- multiline prompt/message.
- payload `prompt`, `input`, atau `messages`.
- dark mode.
- streaming response lewat `fetch`.

Backend sudah mengizinkan CORS dari:

```txt
http://localhost:5007
http://127.0.0.1:5007
http://localhost:5507
http://127.0.0.1:5507
```

Jika memakai `live-server`:

```bash
live-server --port=5507
```

## Endpoint

### `POST /api/responses`

Request body mendukung tiga format.

Format lama:

```json
{
  "prompt": "Selamat sore!"
}
```

Format baru:

```json
{
  "input": [
    {
      "role": "assistant",
      "content": "Anda adalah assistant yang membantu."
    },
    {
      "role": "user",
      "content": "Selamat sore!"
    }
  ]
}
```

Format `messages`:

```json
{
  "messages": [
    {
      "role": "assistant",
      "content": "Anda adalah assistant yang membantu."
    },
    {
      "role": "user",
      "content": "Selamat sore!"
    }
  ]
}
```

Contoh `curl`:

```bash
curl "http://127.0.0.1:3000/api/responses" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {
        "role": "assistant",
        "content": "Anda adalah assistant yang membantu."
      },
      {
        "role": "user",
        "content": "Selamat sore!"
      }
    ]
  }'
```

Contoh `curl` dengan `messages`:

```bash
curl "http://127.0.0.1:3000/api/responses" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "assistant",
        "content": "Anda adalah assistant yang membantu."
      },
      {
        "role": "user",
        "content": "Selamat sore!"
      }
    ]
  }'
```

Response dikirim sebagai SSE:

```txt
data: {"type":"content","delta":"..."}

data: [DONE]
```

Event yang dikirim ke client:

- `reasoning`: potongan reasoning summary.
- `content`: potongan output text.
- `responses.completed`: penanda response selesai.
- `incomplete`: response dari model belum lengkap.
- `error`: error dari backend atau model.

## Catatan

Pastikan model endpoint menerima header berikut:

```txt
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Backend akan memanggil:

```txt
<MODEL_BASE_URL>/v1/responses
```
