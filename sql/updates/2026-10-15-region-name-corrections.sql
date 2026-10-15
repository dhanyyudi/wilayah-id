-- Region name corrections, 2026-10-15.
-- 32 regency names from region-id v1.0.2 plus 2 district and 25 village names
-- from data-region-id/name-corrections.csv. Each UPDATE matches the old name,
-- so a rerun changes nothing, and a row holding any other name makes the final
-- check roll the whole transaction back.
-- Run once against the wilayah-id database:
--   psql -v ON_ERROR_STOP=1 -f sql/updates/2026-10-15-region-name-corrections.sql

BEGIN;

CREATE TEMP TABLE name_fix (tbl text, code text, old_name text, new_name text) ON COMMIT DROP;
INSERT INTO name_fix VALUES
  ('kabupaten', '1172', 'Kota Sabang Sumatera Utara', 'Kota Sabang'),
  ('kabupaten', '1175', 'Kota Subulussalam Darussalam', 'Kota Subulussalam'),
  ('kabupaten', '1217', 'Kabupaten Samosir Bedagai', 'Kabupaten Samosir'),
  ('kabupaten', '1218', 'Kabupaten Serdang Bedagai Bedagai', 'Kabupaten Serdang Bedagai'),
  ('kabupaten', '1307', 'Kabupaten Lima Puluh', 'Kabupaten Lima Puluh Kota'),
  ('kabupaten', '1612', 'Kabupaten Penukal Abab Lematang', 'Kabupaten Penukal Abab Lematang Ilir'),
  ('kabupaten', '3276', 'Kota Depok Kotamadya Daerah', 'Kota Depok'),
  ('kabupaten', '3514', 'Kabupaten Pasuruan Kecamatan Bangil', 'Kabupaten Pasuruan'),
  ('kabupaten', '3672', 'Kota Cilegon Kotamadya Daerah', 'Kota Cilegon'),
  ('kabupaten', '6310', 'Kabupaten Tanah Bumbu Balangan', 'Kabupaten Tanah Bumbu'),
  ('kabupaten', '6311', 'Kabupaten Balangan Balangan', 'Kabupaten Balangan'),
  ('kabupaten', '6407', 'Kabupaten Kutai Barat Kutai', 'Kabupaten Kutai Barat'),
  ('kabupaten', '6408', 'Kabupaten Kutai Timur Kutai', 'Kabupaten Kutai Timur'),
  ('kabupaten', '6474', 'Kota Bontang Kutai', 'Kota Bontang'),
  ('kabupaten', '6502', 'Kabupaten Malinau Kutai', 'Kabupaten Malinau'),
  ('kabupaten', '6503', 'Kabupaten Nunukan Kutai', 'Kabupaten Nunukan'),
  ('kabupaten', '7105', 'Kabupaten Minahasa Selatan Tomohon', 'Kabupaten Minahasa Selatan'),
  ('kabupaten', '7109', 'Kabupaten Kepulauan Siau Tagulandang', 'Kabupaten Kepulauan Siau Tagulandang Biaro'),
  ('kabupaten', '7173', 'Kota Tomohon Tomohon', 'Kota Tomohon'),
  ('kabupaten', '7310', 'Kabupaten Pangkajene', 'Kabupaten Pangkajene dan Kepulauan'),
  ('kabupaten', '7324', 'Kabupaten Luwu Timur Utara', 'Kabupaten Luwu Timur'),
  ('kabupaten', '7503', 'Kabupaten Bone Bolango Pohuwato', 'Kabupaten Bone Bolango'),
  ('kabupaten', '7504', 'Kabupaten Pohuwato Pohuwato', 'Kabupaten Pohuwato'),
  ('kabupaten', '7601', 'Kabupaten Pasangkayu Utara', 'Kabupaten Pasangkayu'),
  ('kabupaten', '8107', 'Kabupaten Kepulauan Aru Seram', 'Kabupaten Kepulauan Aru'),
  ('kabupaten', '8201', 'Kabupaten Halmahera Barat Halmahera', 'Kabupaten Halmahera Barat'),
  ('kabupaten', '8203', 'Kabupaten Halmahera Utara Halmahera', 'Kabupaten Halmahera Utara'),
  ('kabupaten', '8204', 'Kabupaten Halmahera Selatan Halmahera', 'Kabupaten Halmahera Selatan'),
  ('kabupaten', '8205', 'Kabupaten Kepulauan Sula Halmahera', 'Kabupaten Kepulauan Sula'),
  ('kabupaten', '8206', 'Kabupaten Halmahera Timur Halmahera', 'Kabupaten Halmahera Timur'),
  ('kabupaten', '8272', 'Kota Tidore Kepulauan Halmahera', 'Kota Tidore Kepulauan'),
  ('kabupaten', '9401', 'Kabupaten Nabire Paniai', 'Kabupaten Nabire'),
  ('kecamatan', '150705', 'S a d u', 'Sadu'),
  ('kecamatan', '310102', 'Kepulauan Seribu Selatan.', 'Kepulauan Seribu Selatan'),
  ('desa', '1271151001', 'A u r', 'Aur'),
  ('desa', '1271151003', 'J a t i', 'Jati'),
  ('desa', '5303112005', 'N i a n', 'Nian'),
  ('desa', '7103122009', 'B e b u', 'Bebu'),
  ('desa', '7103122012', 'D a g h o', 'Dagho'),
  ('desa', '7104021005', 'B e o', 'Beo'),
  ('desa', '7104032003', 'A l o', 'Alo'),
  ('desa', '7104032004', 'N u n u', 'Nunu'),
  ('desa', '7104032005', 'R a i n i s', 'Rainis'),
  ('desa', '7104042006', 'E s s a n g', 'Essang'),
  ('desa', '7104082004', 'G e m e h', 'Gemeh'),
  ('desa', '7104102003', 'R i u n g', 'Riung'),
  ('desa', '7104102004', 'A m m a t', 'Ammat'),
  ('desa', '7104192008', 'K u m a', 'Kuma'),
  ('desa', '1212022004', 'Sibarani Nasampulu/Namungk up', 'Sibarani Nasampulu/Namungkup'),
  ('desa', '3306122035', 'Kedungpomahanwet an', 'Kedungpomahanwetan'),
  ('desa', '3306122037', 'Kedungpomahankulo n', 'Kedungpomahankulon'),
  ('desa', '3515122020', 'Bakungtemenggunga n', 'Bakungtemenggungan'),
  ('desa', '9504442005', 'Leragawi/Megagiraku k', 'Leragawi/Megagirakuk'),
  ('desa', '1101062024', 'Air Sialang Hilir.', 'Air Sialang Hilir'),
  ('desa', '1108172014', 'U Baro.', 'U Baro'),
  ('desa', '1277011012', 'Losung Batu.', 'Losung Batu'),
  ('desa', '7203112013', 'Ujumbou.', 'Ujumbou'),
  ('desa', '9120072005', 'Teuw*', 'Teuw'),
  ('desa', '7401011001', 'Nopember', '19 Nopember');

UPDATE kabupaten AS x SET nama_kabupaten = f.new_name, updated_at = NOW()
FROM name_fix f
WHERE f.tbl = 'kabupaten' AND x.kode_kab = f.code AND x.nama_kabupaten = f.old_name;

UPDATE kecamatan AS x SET nama_kecamatan = f.new_name, updated_at = NOW()
FROM name_fix f
WHERE f.tbl = 'kecamatan' AND x.kode_kec = f.code AND x.nama_kecamatan = f.old_name;

UPDATE desa AS x SET nama_desa = f.new_name, updated_at = NOW()
FROM name_fix f
WHERE f.tbl = 'desa' AND x.kode_desa = f.code AND x.nama_desa = f.old_name;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining FROM name_fix f
  WHERE NOT EXISTS (SELECT 1 FROM kabupaten WHERE f.tbl = 'kabupaten' AND kode_kab = f.code AND nama_kabupaten = f.new_name)
    AND NOT EXISTS (SELECT 1 FROM kecamatan WHERE f.tbl = 'kecamatan' AND kode_kec = f.code AND nama_kecamatan = f.new_name)
    AND NOT EXISTS (SELECT 1 FROM desa WHERE f.tbl = 'desa' AND kode_desa = f.code AND nama_desa = f.new_name);
  IF remaining <> 0 THEN
    RAISE EXCEPTION '% of 59 names were not corrected', remaining;
  END IF;
END $$;

COMMIT;
