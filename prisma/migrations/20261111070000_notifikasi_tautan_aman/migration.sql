-- Tautan notifikasi tidak boleh memuat garis miring terbalik atau karakter kendali. Peramban mengubah "\" menjadi "/"
-- dan membuang tab atau baris baru di dalam URL, sehingga "/\luar.contoh" dan "/<TAB>/luar.contoh" lolos dari
-- Notifikasi_tautan_internal tetapi terbuka sebagai URL luar. Aplikasi juga menolaknya (tautanInternal di
-- src/lib/notifikasi.ts); CHECK ini pengaman terakhir. Aditif: CHECK lama tetap berlaku.
ALTER TABLE "Notifikasi" ADD CONSTRAINT "Notifikasi_tautan_tanpa_kendali" CHECK ("tautan" IS NULL OR "tautan" !~ '[\\\x01-\x1f\x7f]');
