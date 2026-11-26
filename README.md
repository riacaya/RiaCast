# RiaCast

Aplikasi broadcaster WebRTC berbasis PeerJS untuk siaran P2P.

## Fitur

- **Penyiar (Admin)**: PeerJS ID tetap `riacast-99`
- **Penonton**: ID otomatis `rc-(waktu login)`
- Semua pengguna default masuk sebagai penonton
- Deteksi admin otomatis, permintaan sambungan otomatis, auto-approve
- Pertukaran video dan audio dua arah (P2P)
- Siap multi-user

## Alur

### Admin / Penyiar
1. Buka aplikasi (default sebagai penonton).
2. Klik ikon admin di header.
3. Masukkan password admin.
4. Setelah verifikasi, sesi penonton keluar, halaman refresh, dan masuk sebagai penyiar (`riacast-99`).

### Penonton
1. Buka aplikasi (otomatis connect sebagai penonton `rc-<timestamp>`).
2. Aplikasi mendeteksi admin aktif.
3. Saat admin aktif, penonton otomatis meminta sambungan WebRTC.
4. Admin auto-approve, lalu video/audio bertukar seperti panggilan video P2P.

## Menjalankan lokal

Karena aplikasi menggunakan kamera/mikrofon, jalankan lewat server lokal (bukan `file://`):

```bash
# Python
python -m http.server 8080

# atau Node
npx serve .
```

Lalu buka `http://localhost:8080`.

## Struktur

- `index.html` - UI utama
- `style.css` - styling
- `app.js` - logika PeerJS/WebRTC/admin/viewer
- `peerjs.min.js` - library PeerJS
- `assets/` - logo dan aset statis
- `download/` - tempat artefak APK/EXE

## Catatan rilis

- Folder `windows/` dan `android/` tidak disertakan di repo.
- File APK dan EXE ditempatkan di folder `download/`.
