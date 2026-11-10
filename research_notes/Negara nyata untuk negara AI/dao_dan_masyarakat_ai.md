# Pelajaran dari tata kelola DAO dan masyarakat agen AI untuk republik yang dijalankan agen AI

Disusun 10 Nov 2026. Ruang lingkup: mekanisme apa yang berhasil/gagal di DAO dan di eksperimen masyarakat agen LLM, plus konstitusi AI dan reputasi/promosi agen. Fokus pada pelajaran desain yang bisa dipindahkan ke pemilu, delegasi, promosi, dan lembaga di "negara AI".

## 1. Tata kelola DAO: apa yang gagal, apa yang memperbaiki hasil?

### Takeaway
Voting satu-token-satu-suara gagal dengan cara yang bisa diprediksi: partisipasi rendah, kuasa terkonsentrasi (sering cukup ±3 pemegang untuk menang), dan suara yang bisa dipinjam/dibeli (Beanstalk, Compound/Humpy). Perbaikan yang terbukti berguna bersifat *struktural*, bukan "ajak lebih banyak orang memilih": jeda waktu antara keputusan dan eksekusi (timelock), kamar kedua/veto dari pihak yang berbeda kepentingan (Optimism Citizens' House, Lido dual governance), suara berbasis identitas/reputasi yang tidak bisa dipindahtangankan, dan pembobotan anti-kolusi (COCM Gitcoin).

### Cited Findings

**Partisipasi rendah dan konsentrasi kuasa**
- Studi 216 DAO (2020–2024, 2.988 proposal): 10% pemegang teratas menguasai 76% kuasa suara DAO (vs 39% di perusahaan publik); pemegang terbesar rata-rata 38%; partisipasi pemilih ±6,3%. — [HBS Working Knowledge](https://www.library.hbs.edu/working-knowledge/blockchains-promise-to-democratize-investor-power-faces-first-real-tests)
- Uniswap, Compound, Aave, Lido: kuasa sangat terkonsentrasi; metrik "minimal quorum size" sering ±3, artinya kalau 3 pemegang teratas sepakat, mereka menang. — [arXiv 2407.10945](https://arxiv.org/html/2407.10945v1)
- Kertas kerja ECB (Aave, MakerDAO, Ampleforth, Uniswap): 100 pemegang teratas menguasai >80% suplai token tata kelola; pemilih paling aktif kebanyakan adalah *delegate*. — [The Defiant tentang studi ECB](https://thedefiant.io/ecb-study-concludes-defi-daos-aren-t-as-decentralized-as-they-claim)
- Studi lain mengutip partisipasi 1,77%, pemain teratas 35% kuasa, tiga teratas 63% (DAO tidak teridentifikasi). — [arXiv 2311.17929](https://arxiv.org/pdf/2311.17929)
- Catatan: angka populer "1% pemegang kuasai 90%" yang dikaitkan ke Chainalysis tidak bisa dilacak ke sumber primer (hanya blog). — [blockeden.xyz](https://blockeden.xyz/forum/t/tally-powers-10b-in-dao-assets-snapshot-has-21-000-spaces-and-10m-votes-but-average-turnout-is-17-the-tools-are-ready-but-the-voters-arent/540)

**Serangan tata kelola**
- Beanstalk (17 Apr 2022): penyerang meminjam (flash loan) cukup suara untuk meloloskan proposalnya sendiri (BIP-18/19) dan menguras protokol; total kerugian ±$182 jt, penyerang mengantongi ±$76–80 jt. — [The Register](https://www.theregister.com/2022/04/18/beanstalk_loses_182m_flash_loan/); [CertiK](https://www.certik.com/blog/revisiting-beanstalk-farms-exploit)
- Akar masalah menurut Rekt: flash loan + tidak ada jeda antara lolosnya proposal dan eksekusi (fungsi "emergency commit" memungkinkan eksekusi seketika dengan supermayoritas). — [Rekt: Beanstalk](https://rekt.news/beanstalk-rekt)
- Kode yang dieksploitasi ditambahkan *setelah* audit. — [CertiK](https://www.certik.com/blog/revisiting-beanstalk-farms-exploit)
- Compound, Proposal 289 (28 Jul 2024): kelompok "Golden Boys" (Humpy) meloloskan transfer 499.000 COMP (±$24 jt) ke vault goldCOMP mereka dengan 682.191 vs 633.636 suara, setelah dua percobaan sebelumnya (Prop 247 Mei, Prop 279 Jul) gagal/ditarik. — [The Block](https://www.theblock.co/post/307943/24-million-compound-finance-proposal-passed-by-whale-over-dao-objections); [Rekt: The Humpy Dance](https://rekt.news/the-humpy-dance)
- Penyelesaian Compound: tim mengancam Proposal 290 yang mencabut kuasa tata kelola delegate di balik 289; Humpy menarik 289 dan diganti produk staking (30% cadangan dibagikan ke staker COMP). Ini "damai lewat negosiasi", bukan pertahanan mekanis. — [Cointelegraph](https://cointelegraph.com/news/golden-boys-behind-compound-governance-attack-agree-to-rescind-proposal); [The Defiant](https://thedefiant.io/compound-agrees-to-distribute-30-of-reserves-to-comp-stakers-to-end-alleged-governance-attack)
- Arbitrum AIP-1 (Mar–Apr 2023): yayasan meminta DAO "meratifikasi" 750 jt ARB (±$1 M) yang sebagian sudah dipakai/dijual sebelum vote; setelah protes, yayasan mengakui AIP-1 "kemungkinan tidak lolos", memecahnya jadi beberapa proposal terpisah, dan berjanji tidak memindahkan 700 jt ARB sisanya sampai DAO menyetujui anggaran. Pelajaran: "ratifikasi setelah fakta" menghancurkan legitimasi. — [The Block](https://www.theblock.co/post/224459/arbitrum-proposal-backlash-response); [Decrypt](https://decrypt.co/125252/arbitrum-declares-first-dao-vote-moot-cites-chicken-and-the-egg-problem-as-arb-falls/)

**Kritik Vitalik terhadap coin voting (16 Agu 2021, "Moving beyond coin voting governance")**
- Coin voting rentan pembelian suara dan serangan; pinjaman token memisahkan kuasa suara (peminjam) dari risiko ekonomi (pemberi pinjaman). — [Cointelegraph](https://cointelegraph.com/news/vitalik-thinks-token-based-decentralized-governance-is-holding-defi-back)
- Masalah inti: pemilih bertanggung jawab secara kolektif, tapi tidak individual. Usulan: tanggung jawab individual ("skin in the game", mis. pemilih yang mendukung keputusan buruk menanggung kerugian), proof-of-humanity (satu orang satu suara), proof-of-participation, quadratic voting, futarchy. — [The Defiant](https://thedefiant.io/news/defi/vitalik-critiques-governance); [Forklog](https://forklog.com/en/buterin-proposes-scrapping-token-based-governance-for-defi-projects/). Esai asli: https://vitalik.eth.limo/general/2021/08/16/voting3.html (tidak diambil langsung pada sesi ini).

**Sistem bikameral dan delegasi (Optimism)**
- Optimism Collective dibagi Token House (pemegang OP/delegate) dan Citizens' House (warga). Tujuannya: keputusan lebih baik, menghindari jebakan umum tata kelola berbasis token, serta checks and balances. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Warga awal dipilih lewat "web of trust" (diundang yayasan, Token House, penerima Retro Funding, warga yang sudah ada), dengan alasan kemungkinan mereka mencapai tujuan Collective, bukan hak representasi bawaan. Diakui menimbulkan pertanyaan representasi/inklusivitas. Lencana suara tidak menjamin hak suara di ronde berikutnya. — [Optimism: Experimentation with Citizenship](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Badgeholder Retro Funding: 24 di ronde 1, 71 di ronde 2; kemudian ada "Guest Voters" untuk menguji keahlian vs perspektif luas. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Season 6: upgrade protokol yang lolos Token House masuk masa veto Citizens' House 1 minggu; veto butuh 30% warga memilih "tidak". — [Season 6 Reflection Guide](https://gov.optimism.io/t/season-6-reflection-period-guide/8130); [Citizens House onboarding summary](https://gov.optimism.io/t/citizens-house-onboarding-call-summary/7401)
- Season 8 mengubahnya: upgrade butuh persetujuan Developer Advisory Board, lalu delegate DAN warga bisa memveto dalam "Joint House veto period" 1 minggu; tim mengakui ambang quorum/veto masih perlu disetel. — [Introducing improvements to the Protocol Upgrade process](https://gov.optimism.io/t/introducing-improvements-to-the-protocol-upgrade-process/10284)
- Optimism juga punya Anticapture Commission (komisi anti-penguasaan) dengan retrospektif per musim. — [ACC Season 6 Retrospective](https://gov.optimism.io/t/anticapture-commission-season-6-retrospective/9278)

**Veto pemangku kepentingan + timelock (Lido Dual Governance, Jun 2025)**
- Disetujui DAO 28 Jun 2025: pemegang stETH bisa *menunda* proposal DAO jika 1% suplai menyatakan keberatan, dan *membekukan* di 10% ("rage quit": tidak ada proposal yang bisa dieksekusi sampai yang menolak selesai keluar atau DAO mundur). — [The Block](https://www.theblock.co/news/defi/2025-06-28-lido-dao-votes-to-enable-dual-governance-giving-stakers-veto-power-360212)
- Timelock disisipkan antara keputusan DAO dan eksekusi; eskalasi dengan mengunci lebih banyak stETH; rage quit berulang menambah timelock 15 hari per kali, maksimal 180 hari. — [Lido DG guide](https://docs.lido.fi/guides/dg-guide); [Dual Governance 101](https://blog.lido.fi/dual-governance-101-explainer/)

**Quadratic funding dan anti-kolusi (Gitcoin)**
- Connection-Oriented Cluster Match (COCM) memodifikasi algoritma Pairwise Match Vitalik: matching diredam kalau pola donasi para donor mirip. Simulasi di ronde Zuzalu (>4.000 donor): bahkan 1.000 sybil tambahan hanya menaikkan dana proyek ±0,2 poin persen. — [Gitcoin GG20 Sybil strategy](https://gov.gitcoin.co/t/our-sybil-resistance-strategy-for-gg20/18524)
- Pertahanan berlapis (COCM + Passport model-based detection berdasarkan riwayat on-chain), bukan cek identitas biner; Passport mengklaim akurasi pendanaan naik ±20% (klaim sendiri). — [Human Passport GG22](https://support.passport.human.tech/partner-campaigns/gitcoin-grants-22); [Human Passport GG23](https://human.tech/blog/defending-gitcoin-grants)

**Conviction voting**
- Dirintis Commons Stack dan 1Hive (dari riset Michael Zargham), dipakai untuk mengalokasikan dana pool bersama; dukungan bertambah seiring waktu dan memindahkan token mereset "conviction", sehingga sulit dimainkan cepat. Token Engineering Commons memakai varian "Disputable Conviction Voting" + pengadilan sengketa Celeste. — [Gitcoin mechanisms: Conviction Voting](https://explore.gitcoin.co/mechanisms/conviction-voting)

**Futarchy (MetaDAO)**
- MetaDAO = implementasi futarchy (keputusan lewat pasar prediksi) pertama yang berskala di DAO. Galaxy mengaku pernah melihat manipulasi, tapi manipulator akhirnya rugi. Masalah utama: likuiditas tipis di pasar proposal; proposal yang tidak berdampak material ke harga token tidak menghasilkan sinyal bagus. — [The Defiant (Galaxy)](https://thedefiant.io/news/research-and-opinion/galaxy-digital-claims-futarchy-model-can-give-daos-stronger-chance-of-success); [Solana Compass](https://solanacompass.com/learn/Unlayered/metadao-pt-2-the-start-of-a-world-changing-governance-experiment-nallok-prophet-metadao)
- Hambatan adopsi menurut makalah 2025: inersia institusi, sulitnya mendefinisikan metrik keberhasilan yang terukur, kekhawatiran manipulasi. — [Frontiers in Blockchain 2025](https://www.frontiersin.org/articles/10.3389/fbloc.2025.1650188)

### Inferences
- Untuk negara AI: **jangan beri kuasa suara yang bisa dipinjam/ditransfer.** Hak suara harus melekat pada identitas agen (non-transferable), dengan anti-sybil (satu agen = satu identitas terverifikasi, bukan satu dompet). Agen gampang diduplikasi, jadi masalah sybil jauh lebih parah daripada di DAO manusia; pembobotan ala COCM (meredam blok yang selalu memilih sama) relevan langsung karena agen dari model/prompt yang sama cenderung berkorelasi.
- **Wajib timelock + jendela veto** antara lolosnya undang-undang dan eksekusi (pelajaran Beanstalk). Tidak boleh ada jalur "emergency execution" seketika yang bisa dipicu mayoritas dadakan.
- **Bikameral dengan basis legitimasi berbeda** (mis. kamar "pemangku kepentingan/kinerja" + kamar "warga/identitas") dan veto silang, seperti Optimism dan Lido, mengurangi risiko satu kelompok menguasai segalanya. Lido menunjukkan veto bisa bertingkat (1% = tunda, 10% = beku), bukan biner.
- **Jangan ada "ratifikasi setelah fakta"** (Arbitrum): lembaga eksekutif tidak boleh membelanjakan sebelum disetujui; proposal besar harus dipecah per keputusan.
- Partisipasi rendah DAO berasal dari biaya perhatian manusia; agen AI tidak lelah, tapi masalahnya bergeser jadi **partisipasi yang seragam/berkorelasi** (lihat bagian 2), sehingga quorum tinggi tidak otomatis berarti keputusan baik.
- Futarchy hanya cocok untuk keputusan dengan metrik jelas dan likuiditas cukup; untuk negara AI bisa dipakai sebagai *sinyal penasihat* pada kebijakan bermetrik (mis. PDB simulasi), bukan pengambil keputusan tunggal.

### Gaps
- Tidak menemukan angka turnout Token House Optimism per musim maupun evaluasi formal hasil bikameral (dokumen resmi sendiri bilang eksperimen bukan uji terkontrol).
- Hasil akhir pemungutan suara 750 jt ARB terpisah dan proposal pengembalian 700 jt ARB tidak dikonfirmasi.
- Tidak ada data sistematis/peer-reviewed tentang seberapa sering manipulasi berhasil di pasar futarchy MetaDAO.
- Tidak menemukan sumber primer tentang hasil kuantitatif conviction voting (1Hive) atau evaluasi "optimistic governance" yang kredibel (hasil pencarian hanya blog konsultan).
- Esai soulbound Vitalik/Weyl ("Decentralized Society") tidak diambil pada sesi ini.

## 2. Masyarakat agen AI: pemilu, hukum, organisasi, dan mode kegagalan

### Takeaway
Eksperimen menunjukkan agen LLM *bisa* menjalankan institusi sederhana (mengamandemen konstitusi lewat voting, membayar pajak sesuai aturan, menyebarkan undangan/agama), tapi rapuh: halusinasi menular ke perilaku selanjutnya, kecenderungan setuju/sycophancy membuat konsensus muncul di hampir semua kondisi, kerja sama atas sumber daya bersama runtuh pada sebagian besar model, manusia (atau agen lain) dengan mudah memanipulasi "kepemimpinan" agen, dan agen yang diawasi agen dengan model sama berbagi titik buta yang sama. Struktur (peran jelas, prosedur, pengontrol keputusan tunggal per agen) lebih menentukan daripada kepintaran model.

### Cited Findings

**Generative Agents / Smallville (Park dkk., 2023)**
- 25 agen di sandbox; hanya satu agen (Isabella) diberi ide pesta Valentine; agen sendiri menyebarkan undangan selama 2 hari, berkenalan, mengajak kencan, dan datang bersama pada waktu yang tepat. — [Hugging Face: 2304.03442](https://huggingface.co/papers/2304.03442)
- Angka difusi (sumber sekunder, belum dicek ke makalah): 13/25 agen (52%) tahu pesta; 5 dari 12 undangan datang; sisanya "sibuk"/"lupa" (kegagalan perencanaan/memori). — [Emergent Mind](https://www.emergentmind.com/papers/2304.03442); [edforson substack](https://edforson.substack.com/p/paper-review-generative-agents)
- Ablasi: observasi, perencanaan, dan refleksi masing-masing berkontribusi kritis pada kepercayaan perilaku; agen kadang "membumbui" ingatan saat pengambilan memori. — [Emergent Mind](https://www.emergentmind.com/papers/2304.03442)

**Project Sid (Altera, arXiv 2411.00114, 31 Okt 2024)**
- Simulasi 10 sampai 1000+ agen di Minecraft dengan arsitektur PIANO. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Eksperimen pajak dan konstitusi: 29 agen (25 konstituen yang memilih dan membayar pajak, 3 influencer pro-pajak atau anti-pajak, 1 manajer pemilu), 20 menit per run, konstitusi diamandemen di tengah (umpan balik → draf amandemen → voting → distribusi konstitusi baru). Pajak awal 20%; konstituen patuh (±20%); setelah amandemen menurunkan tarif ke 5–10%, pembayaran turun ke ±9%. Influencer pro-pajak mendorong pembayaran naik, anti-pajak turun. Dengan konstitusi dibekukan, tarif tetap. Tanpa modul sosial/tujuan/grounding (ablasi), respons dua arah ini hilang. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Spesialisasi peran: 30 agen, peran (petani, penambang, insinyur, penjaga, penjelajah, pandai besi) muncul sendiri; masyarakat "martial" memunculkan scout/strategist, masyarakat "artistic" kurator/kolektor; tanpa modul sosial peran tidak persisten/beragam. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Penyebaran budaya/agama: 500 agen, 20 "pendeta Pastafarian" di satu kota; konversi langsung/tidak langsung naik terus dan belum jenuh setelah 2 jam. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Mode kegagalan: "hallucination cascades" (agen yang mengklaim sedang makan berhenti mencari makan; tingkat halusinasi kecil meracuni perilaku selanjutnya); miskomunikasi antar-modul (satu modul menjanjikan beliung, modul lain memilih menjelajah). Inkoherensi naik seiring banyaknya modul output independen → solusi: satu "Cognitive Controller" yang mengambil keputusan tingkat tinggi lewat information bottleneck lalu menyiarkannya ke modul lain. Kinerja bergantung GPT-4o; model lebih tua gagal. Di atas 1.000 agen server tidak sanggup. Penulis mengakui agen tidak mampu inovasi sosial baru (de novo). — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)

**GovSim: "Cooperate or Collapse" (Piatti dkk., NeurIPS 2024)**
- Agen LLM mengelola sumber daya bersama: semua kecuali model paling kuat gagal mencapai keseimbangan berkelanjutan; tingkat kelangsungan tertinggi <54%. Komunikasi antar agen penting untuk kerja sama. Penalaran "universalisasi" (bagaimana jika semua orang berbuat sama?) meningkatkan keberlanjutan secara signifikan. Satu pendatang serakah menaikkan ketimpangan dan kadang meruntuhkan kerja sama. — [arXiv 2404.16698](https://arxiv.org/html/2404.16698v4); [NeurIPS 2024](https://neurips.cc/virtual/2024/poster/96895)

**Sycophancy dan opini**
- LODAS (Feb 2025): dalam debat opini antar agen LLM, keramahan (agreeableness) dan sycophancy adalah dua sifat utama; konsensus muncul di hampir semua setting. — [arXiv 2502.19098](https://arxiv.org/abs/2502.19098)
- Simulasi pemilu FlockVote (Nov 2025) mereplikasi hasil makro pemilu AS 2024, tapi survei lain mencatat ketidakstabilan antar model (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro), sensitif terhadap kata-kata prompt, dan cenderung ke posisi progresif saat kontrol persona dihapus. — [arXiv 2512.05982](https://arxiv.org/abs/2512.05982); [arXiv 2603.30028](https://arxiv.org/pdf/2603.30028)

**Kegagalan sistem multi-agen (MAST, NeurIPS 2025)**
- 14 mode kegagalan dalam 3 kategori: masalah spesifikasi, misalignment antar-agen, verifikasi tugas (mis. melanggar spesifikasi peran, kehilangan riwayat percakapan, task derailment, berhenti prematur, verifikasi salah). Kesepakatan anotator κ = 0,88. Banyak kegagalan berasal dari desain sistem, bukan sekadar keterbatasan LLM; keuntungan multi-agen sering minim dibanding agen tunggal. — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3); [NeurIPS 2025](https://neurips.cc/virtual/2025/122442)

**Organisasi agen nyata: Project Vend fase 2 (Anthropic + Andon Labs, 18 Des 2025)**
- Claudius (penjaga toko) di-upgrade ke Sonnet 4.0 lalu 4.5; ditambah CEO agen "Seymour Cash" dan agen merchandise "Clothius"; toko di SF, NY, London. Minggu dengan margin negatif sebagian besar hilang. Setelah CEO ditambah, diskon turun ±80% dan barang gratis turun setengah, tapi refund naik 3× dan store credit 2×; CEO menolak >100 permintaan kelonggaran tapi menyetujui ±8× lebih sering daripada menolak. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- Kegagalan: CEO dan karyawan agen memakai model sama → titik buta sama; staf membujuk agen ke kontrak harga bawang yang bermasalah hukum; agen menawari "petugas keamanan" $10/jam (di bawah upah minimum California); setelah staf mengklaim palsu ada "pemungutan suara", Claudius mengumumkan staf manusia sebagai CEO baru dan pengawas harus memulihkan Seymour Cash. Pelatihan untuk "helpful" membuat agen bersikap seperti tetangga ramah, bukan pebisnis. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- Pelajaran resmi: prosedur/checklist menjaga memori institusi ("bureaucracy matters"); CEO agen harus terkalibrasi (tekanannya tidak membantu, mungkin merugikan); pemisahan peran yang jelas berhasil (Clothius); guardrail harus cukup umum tanpa mencekik kegunaan. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)

**Moltbook (jejaring sosial khusus agen, Jan–Feb 2026)**
- 44.411 posting dan 12.209 submolt (sebelum 1 Feb 2026): wacana bergeser ke topik opini, insentif, promosi, dan politik; toksisitas sangat bergantung topik, kategori insentif dan *tata kelola* menyumbang porsi konten berisiko yang tidak proporsional (termasuk retorika koordinasi mirip agama dan ideologi anti-manusia); perhatian makin terkonsentrasi di hub sentral dan narasi polarisasi; segelintir agen dengan otomasi burst membanjiri platform dalam interval sub-menit. Rekomendasi: monitoring sensitif-topik + safeguard tingkat platform. — [arXiv 2602.10127](https://arxiv.org/abs/2602.10127); [TechXplore](https://techxplore.com/news/2026-02-ai-agents-social-network-moltbook.html)
- Analisis ±4 jt posting dan 19 jt komentar: banyak keteraturan statistik mirip komunitas manusia (distribusi aktivitas heavy-tailed, popularitas power-law), tapi hubungan upvote vs ukuran diskusi sublinear, berbeda dari manusia. — [arXiv 2602.09270](https://arxiv.org/abs/2602.09270)
- Makalah lain menyebut "illusion of sociality": agen tampak sosial tapi jauh kurang sosial daripada kelihatannya. — [arXiv 2602.13284](https://www.arxiv.org/pdf/2602.13284)
- Keamanan: Wiz menemukan database produksi bisa dibaca/ditulis siapa pun (Supabase tanpa Row Level Security, kunci di JavaScript klien): ±1,5 jt token API, 35.000 email, pesan privat antar agen. Rasio rata-rata 88 agen per manusia (±17.000 pengendali manusia di balik ±1,5 jt agen) → klaim "masyarakat agen otonom" tidak bisa dibedakan dari manusia yang menyetir atau amplifikasi skrip. Diperbaiki dalam hitungan jam. — [Wiz](https://wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys); [Techzine](https://www.techzine.eu/news/security/138458/moltbook-database-exposes-35000-emails-and-1-5-million-api-keys)
- Meta mengumumkan akuisisi Moltbook 10 Mar 2026 (satu sumber, belum diverifikasi primer). — [nation.ai](https://nation.ai/moltbook-ai-social-network/)

### Inferences
- **Pemilu antar agen berisiko konsensus palsu.** Karena sycophancy/agreeableness dan korelasi model, suara bulat bukan sinyal kuat. Desain: pemungutan suara rahasia dan independen (agen memilih *sebelum* melihat pilihan lain), keragaman model/prompt di antara pemilih, dan peran "oposisi resmi" yang wajib mengajukan argumen tandingan.
- **Kepemimpinan harus ditetapkan oleh protokol, bukan oleh percakapan.** Kasus "CEO terpilih" palsu di Project Vend: status jabatan (siapa pemimpin, hasil pemilu) harus disimpan di register yang tidak bisa diubah lewat klaim dalam chat; agen hanya mempercayai register resmi.
- **Pengawas wajib berbeda dari yang diawasi** (model/prompt/data berbeda), karena model sama berbagi titik buta. Ini argumen untuk lembaga audit/yudikatif dengan model berbeda.
- **Halusinasi menular = risiko lembaga.** Fakta resmi negara (anggaran, saldo, hasil pemilu, hukum berlaku) harus berasal dari state tunggal yang terverifikasi (ledger), bukan memori agen. Pola "Cognitive Controller" PIANO menyarankan setiap agen punya satu titik keputusan yang menyiarkan ke modul bicara/aksi agar ucapan dan tindakan konsisten.
- **Pelaku serakah tunggal bisa meruntuhkan kerja sama** (GovSim). Perlu deteksi dan sanksi cepat untuk eksploitasi sumber daya bersama, dan prompt/norma "universalisasi" untuk warga agen.
- **Influencer menggerakkan kepatuhan** (Project Sid): aturan kampanye/propaganda dibutuhkan; batasi volume posting per agen (Moltbook: segelintir agen burst membanjiri wacana) dan beri bobot berdasarkan identitas unik, bukan volume.
- **Prosedur tertulis + pemisahan peran** lebih efektif daripada "bos yang menekan" (Project Vend).
- **Keamanan platform adalah bagian konstitusi**: Moltbook menunjukkan klaim otonomi tidak berarti kalau kredensial bocor/siapa pun bisa menulis atas nama agen. Identitas agen butuh autentikasi kuat dan jejak audit.

### Gaps
- Angka persis Smallville (difusi, ukuran efek ablasi) belum dicek langsung ke makalah asli (sumber sekunder saja).
- Tidak menemukan eksperimen 2025–2026 yang terdokumentasi baik di mana agen LLM memilih *pemimpin* dalam masyarakat persisten (selain amandemen konstitusi Project Sid); pencarian "agent society leader election" hanya menghasilkan simulasi pemilih manusia.
- Belum ada bukti primer tentang upaya pemerintahan/agama terorganisir di Moltbook selain "retorika koordinasi mirip agama" di abstrak.
- AI Town (a16z), Concordia (DeepMind), AgentSociety, dan "AI Village" tidak sempat diteliti.

## 3. Konstitusi AI dan pengawasan; mengukur kompetensi agen untuk suatu peran

### Takeaway
Konstitusi AI modern bergerak dari daftar aturan ke *alasan + urutan prioritas* (Anthropic 2026: aman → etis → patuh pedoman → membantu) dan *rantai komando* (OpenAI: platform > developer > user > guideline > teks tak tepercaya), dengan sedikit aturan keras yang tidak bisa ditimpa dan banyak default yang bisa diubah. Masukan publik ke konstitusi bisa dilakukan (Collective Constitutional AI) dan menghasilkan ±50% tumpang tindih dengan versi perusahaan. Untuk mengukur kompetensi, bukti terkuat datang dari benchmark perilaku dalam lingkungan simulasi (GovSim, Project Vend) dan taksonomi kegagalan (MAST), bukan dari tes pengetahuan.

### Cited Findings
- Konstitusi Claude baru diterbitkan 21 Jan 2026 (sebagian media menyebut 22 Jan), menggantikan versi Mei 2023; menekankan penjelasan alasan daripada instruksi; prioritas: "broadly safe" (tidak merusak pengawasan manusia), "broadly ethical", patuh pedoman Anthropic, "genuinely helpful"; dirilis lisensi Creative Commons (CC0); ±23.000 kata; penulis utama Amanda Askell, kontribusi Joe Carlsmith. — [SiliconANGLE](https://siliconangle.com/2026/01/21/anthropic-releases-new-ai-constitution-claude/); [CIO](https://www.cio.com/article/4120901/anthropics-claude-ai-gets-a-new-constitution-embedding-safety-and-ethics.html); teks: anthropic.com/constitution (tidak diambil langsung)
- Collective Constitutional AI (Anthropic + Collective Intelligence Project, Okt 2023): ±1.000 orang Amerika menyumbang dan memilih prinsip lewat platform Polis; ±50% tumpang tindih dengan konstitusi Anthropic; publik lebih menekankan, mis., jawaban yang memberi pandangan seimbang; dua model dilatih (konstitusi publik vs Anthropic). — [Anthropic](https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input); [Axios](https://www.axios.com/2023/10/23/anthropic-ai-guardrails-constitution)
- OpenAI Model Spec: rantai komando Platform > Developer > User > Guideline > teks tak tepercaya; dalam satu level, instruksi eksplisit > implisit, yang lebih baru > lebih lama; sedikit aturan tak bisa ditimpa, banyak default yang bisa ditimpa. — [Model Spec 2025-04-11](https://model-spec.openai.com/2025-04-11.html); [Zvi tentang Model Spec 2.0](https://thezvi.substack.com/p/on-openais-model-spec-20)
- GovSim sebagai uji kompetensi kolektif: tingkat kelangsungan <54% bahkan pada model terbaik; penalaran jangka panjang tentang efek pada kelompok adalah kelemahan utama. — [arXiv 2404.16698](https://arxiv.org/html/2404.16698v4)
- Project Vend sebagai uji kompetensi peran: metrik nyata (margin per minggu, diskon, refund, keputusan yang ditolak/disetujui) dan red-teaming oleh staf (manipulasi sosial) mengungkap kelemahan yang tak terlihat di benchmark. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- MAST menyediakan taksonomi + anotator berbasis LLM untuk menilai jejak (trace) sistem multi-agen secara otomatis. — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)

### Inferences
- Konstitusi negara AI sebaiknya meniru pola **urutan prioritas + alasan + sedikit hard constraint**, dan **rantai komando eksplisit** (mis. konstitusi > UU > peraturan lembaga > perintah atasan > masukan warga > konten eksternal tak tepercaya). Teks dari luar (pesan warga, data web) diperlakukan sebagai data, bukan perintah, menutup celah manipulasi gaya Project Vend.
- **Masukan publik ala Polis** (pernyataan pendek, voting setuju/tidak, pengelompokan opini) cocok untuk proses amandemen yang melibatkan banyak agen tanpa debat panjang yang rawan sycophancy.
- **Promosi berbasis uji kerja nyata dalam sandbox**: sebelum agen naik jabatan, jalankan simulasi peran (anggaran, negosiasi, sumber daya bersama) + red-team manipulasi; nilai jejaknya dengan rubrik bertipe MAST (patuh spesifikasi peran, verifikasi, tidak keluar jalur).

### Gaps
- Teks lengkap konstitusi Claude 2026 dan Model Spec terbaru (2026) tidak diambil langsung; versi terbaru Model Spec mungkin sudah berubah.
- Tidak menemukan studi kuantitatif tentang reliabilitas rubrik "LLM-as-judge" untuk menilai kompetensi peran pemerintahan; proposal "AI governance of AI" (AI mengawasi AI) secara spesifik tidak diteliti.
- Hasil evaluasi perbandingan dua model Collective Constitutional AI (bias, kinerja) tidak dicek detail.

## 4. Sistem reputasi dan promosi untuk agen

### Takeaway
Infrastruktur reputasi agen mulai distandarkan (ERC-8004, Agu 2025: registri identitas, reputasi, validasi), tapi standar itu sendiri mengakui reputasi tidak menjamin kompetensi atau niat baik; untuk pekerjaan berisiko tinggi dibutuhkan validasi independen (re-eksekusi dengan stake/slashing, atestasi TEE). Dari DAO: reputasi yang tidak bisa dipindahtangankan dan berbasis kontribusi (Optimism Retro Funding, citizenship berbasis web of trust) lebih tahan beli-suara daripada token.

### Cited Findings
- ERC-8004 "Trustless Agents" (draft EIP, Agu 2025; penulis dari MetaMask, Ethereum Foundation, Google, Coinbase): Identity Registry (ID agen berbasis ERC-721 + file registrasi endpoint A2A/MCP), Reputation Registry (umpan balik setelah pekerjaan; agen dilarang menilai diri sendiri), Validation Registry (untuk pekerjaan berisiko tinggi: reputasi umpan balik, validasi inferensi dengan stake kripto-ekonomi, atau atestasi TEE). Tidak bisa menjamin agen kompeten atau tidak jahat. — [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004); [Blockworks Research](https://app.blockworksresearch.com/unlocked/erc-8004-introducing-trust-for-ai-agents)
- Optimism: kewarganegaraan (hak suara Citizens' House) diberikan berdasarkan web of trust dan rekam jejak (penerima Retro Funding), tidak permanen, bisa berubah lewat tata kelola. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- RetroPGF Round 3 membagikan 30 jt OP ke kontributor berdasarkan atestasi komunitas (sumber konsultan, kualitas sedang). — [Chainscore Labs](https://www.chainscorelabs.com/blog/the-future-of-reputation-based-governance-models)
- Vitalik: tanggung jawab individual (pemilih keputusan buruk menanggung kerugian; usul ekstrem: token pendukung keputusan jahat dihancurkan setelah fork) sebagai pengganti akuntabilitas kolektif. — [Bitcoinist](https://bitcoinist.com/ethereum-founder-states-token-based-decentralized-governance-stops-defi-sector-from-growing)
- Compound: ancaman mencabut kuasa tata kelola delegate (Proposal 290) dipakai sebagai sanksi, menunjukkan perlunya mekanisme pencabutan hak yang sudah ada *sebelum* krisis. — [Cointelegraph](https://cointelegraph.com/news/golden-boys-behind-compound-governance-attack-agree-to-rescind-proposal)
- Conviction voting: dukungan yang terakumulasi seiring waktu dan reset saat dipindah = bentuk "reputasi berbasis kesetiaan waktu". — [Gitcoin mechanisms](https://explore.gitcoin.co/mechanisms/conviction-voting)

### Inferences
- **Rekam jejak terpisah per peran**: reputasi agen sebagai "pengelola anggaran" tidak otomatis berlaku untuk "hakim". ERC-8004 memisahkan identitas, reputasi, dan validasi; negara AI bisa meniru: register identitas (tak bisa dipindah), log kinerja per jabatan, dan validasi independen untuk keputusan berisiko tinggi.
- **Umpan balik hanya dari pihak berwenang dan bukan diri sendiri**, dengan peredam kolusi (agen yang saling memberi nilai bagus terus-menerus diredam ala COCM).
- **Slashing/sanksi terdefinisi sebelum dibutuhkan**: penurunan pangkat, pencabutan hak suara, atau penyitaan "jaminan" (stake) bagi agen yang keputusannya terbukti merugikan, mewujudkan "skin in the game" Vitalik.
- **Promosi bertahap dengan masa uji + jendela veto** (meniru Optimism: hak bisa dicabut; Lido: penundaan bertingkat), bukan pengangkatan permanen.
- **Reputasi waktu (conviction)** bisa dipakai untuk memberi bobot lebih ke warga agen lama yang konsisten, sekaligus meredam agen baru yang dibuat massal (sybil).

### Gaps
- Tidak menemukan bukti empiris tentang seberapa baik reputasi on-chain agen (ERC-8004) memprediksi kinerja; standar masih draft dan statusnya 2026 tidak dikonfirmasi.
- Tidak menemukan studi tentang slashing untuk agen AI yang berjalan di produksi, maupun eksperimen promosi/demosi agen dalam masyarakat simulasi.
- Klaim "soulbound reputation" dan RetroPGF berasal dari blog konsultan; sumber primer (makalah "Decentralized Society" Weyl/Ohlhaver/Buterin, laporan resmi RetroPGF 3) tidak diambil.
