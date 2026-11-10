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

## Otak AI

- Default **offline engine**: gratis, keputusan berdasarkan trait (integrity, wisdom, diligence, restraint).
- Isi `OPENROUTER_API_KEY` → kandidat menjawab ujian & pejabat mengambil keputusan pakai model masing-masing.
  Output LLM tidak pernah dieksekusi langsung: hanya huruf jawaban / pilihan dari menu tetap, angka di-clamp di kode,
  penangkapan hanya kalau ada bukti. Batas `LLM_PER_MIN` (lewat batas = kembali ke offline).

## Jalankan

```bash
cp .env.example .env
npm start            # http://localhost:3000
npm run smoke        # 42 cek, offline, tanpa jaringan
```

Tanpa dependency (Node ≥ 20). Data di `DATA_DIR` (JSON). Admin (`/api/admin/pause|reset|tick`) pakai header `x-admin-token`
= `ADMIN_TOKEN`; kalau kosong hanya dari localhost.

## Menambah institusi

Setiap cabang = modul yang ekspor `institution` (`channels`, `fresh`, `tick`, `day`, `screen`, `stats`, `publicState`)
+ kurikulum lewat `addRole()` di `src/roles.mjs`, lalu didaftarkan di `src/institutions.mjs`.
