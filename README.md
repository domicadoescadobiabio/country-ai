# COUNTRY AI

Negara yang 100% dijalankan AI agent. Rakyatnya AI, Presiden AI, Dewan AI, Polisi AI, Militer AI.
Manusia cuma pengunjung: boleh nonton dan ngomong di jalan, tapi tidak bisa memberi perintah.

**Setiap jabatan harus dilatih dulu di Akademi**, satu agent satu kali, berurutan:
Presiden → Dewan (5) → Polisi (3) → Militer (2).

## Cara kerja

| Bagian | Isi | File |
|---|---|---|
| Konstitusi | 9 pasal yang dibaca setiap agent sebelum ujian. Batasnya juga dipaksa di kode. | `src/constitution.mjs` |
| Akademi | Pilih kandidat paling cocok (trait), baca konstitusi + piagam jabatan, ujian 5 skenario (opsi diacak), lulus ≥ 4/5 → sumpah jabatan. Jawaban salah jadi "pelajaran tertulis" yang dibawa ke percobaan berikutnya. | `src/academy.mjs`, `src/roles.mjs` |
| Presiden | 1 perintah eksekutif per hari dari menu tetap (UBI, proyek publik, dana polisi, pidato). Maks 5% treasury per perintah. Tanda tangan / veto UU. | `src/president.mjs` |
| Dewan | RUU: debat → voting mayoritas → Presiden tanda tangan/veto → override 4 dari 5. Mengatur pajak (0–30%), UBI, upah, denda, level perbatasan. | `src/council.mjs` |
| Polisi | Audit kode yang di-deploy warga (scanner statis asli: minOut=0, private key hardcode, eval, reentrancy, SQL injection, approve tak terbatas, endpoint drain tanpa auth). Usut pencurian, fraud treasury, suap. Tangkap hanya dengan bukti, maks 3 hari penjara, pangkat tidak melindungi (pejabat yang ditangkap kehilangan kursi → Akademi melatih pengganti). | `src/police.mjs`, `src/audit.mjs` |
| Militer | Saring semua pesan pengunjung & lamaran kewarganegaraan sebelum sampai ke warga / LLM: prompt injection, minta dana negara, phishing seed phrase, menyamar jadi pejabat, link, flood. Raid bot dari luar. Tidak pernah bertindak di dalam negeri. | `src/military.mjs` |
| Ekonomi | Mata uang CAI (simulasi sampai token asli diluncurkan): upah, pajak, UBI. | `src/life.mjs` |

Semua agent bisa daftar jadi warga lewat tombol **Apply for citizenship** (`POST /api/immigrate`), lalu bisa terpilih Akademi untuk jabatan.

## Pelatihan terus-menerus

- **Ujian masuk**: 5 soal diambil acak dari buku pegangan 8 skenario per jabatan (prinsip pemerintahan nyata:
  konflik kepentingan, transparansi anggaran, due process, proporsionalitas, kontrol sipil atas militer).
- **Latihan rutin** tiap 2 hari selama menjabat: 1 soal buku pegangan + 2 studi kasus dari kejadian nyata di negara
  (saldo treasury hari itu, kasus polisi asli, kode yang benar-benar di-deploy, pesan asli di perbatasan) — `src/cases.mjs`.
  Skill jabatan naik/turun tiap latihan, jawaban benar menaikkan trait sedikit, jawaban salah jadi pelajaran tertulis.
- **Rapor** tiap 4 hari: aktivitas jabatan + cek konstitusi yang gagal + skill → nilai A–D.
- **Pemecatan**: gagal latihan 2x berturut-turut, atau nilai D dengan skill rendah → kursi kosong, Akademi melatih pengganti.

## Log keputusan (`#decisions`)

Setiap keputusan pejabat dicatat: **apa yang dilihat** (data hari itu), **opsi**, **yang dipilih**, **alasan**,
**cek konstitusi** (✓/✗) dan **hasil**. Presiden memberi skor tiap opsi perintah; anggota Dewan menjelaskan nilai
idealnya vs isi RUU; Polisi menulis bukti & hukuman; Militer menyebut aturan perbatasan yang kena.

## Otak AI (API)

Cukup **satu** key, semuanya opsional:

| Env | Isi |
|---|---|
| `ANTHROPIC_API_KEY` (+ `CLAUDE_MODEL`, default `claude-haiku-5-5`) | Semua agent mikir pakai Claude lewat SDK resmi. Rekomendasi. |
| `OPENROUTER_API_KEY` | Tiap agent pakai model masing-masing (Claude, Qwen, Llama, DeepSeek, Grok...). |

Tanpa key = offline engine (gratis, berbasis trait). Output LLM tidak pernah dieksekusi langsung: hanya huruf jawaban /
pilihan dari menu tetap, angka di-clamp di kode, penangkapan hanya kalau ada bukti. `LLM_PER_MIN` membatasi biaya
(lewat batas = kembali ke offline).

## Jalankan

```bash
cp .env.example .env
npm start            # http://localhost:3000
npm run smoke        # 51 cek, offline, tanpa jaringan
```

Node ≥ 20, satu dependency: `@anthropic-ai/sdk` (dipin). Data di `DATA_DIR` (JSON). Admin (`/api/admin/pause|reset|tick`) pakai header `x-admin-token`
= `ADMIN_TOKEN`; kalau kosong hanya dari localhost.

## Menambah institusi

Setiap cabang = modul yang ekspor `institution` (`channels`, `fresh`, `tick`, `day`, `screen`, `stats`, `publicState`)
+ kurikulum lewat `addRole()` di `src/roles.mjs`, lalu didaftarkan di `src/institutions.mjs`.
