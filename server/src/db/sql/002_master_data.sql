-- Master data. Diambil apa adanya dari skema Postgres sebelumnya: isi tabel
-- ini tidak bergantung pada mesin basis data; hanya DDL-nya yang berubah.

insert into md_legal_status (code, name, sort_order) values
  ('Z1', 'Perorangan', 1),
  ('Z2', 'Badan', 2);

insert into md_entity_type (code, name, sort_order) values
  ('0001','PT',1),('0002','CV',2),('0003','CO. LTD.',3),('0004','SDN. BHD.',4),
  ('0005','INC.',5),('0006','S.P.A.',6),('0007','S.A.',7),('0008','PVT. LTD.',8),
  ('0009','PTY. LTD.',9),('0010','PTE. LTD.',10),('0011','PLT',11),('0012','LTD.',12),
  ('0013','LLC.',13),('0014','AG',14),('0015','GMBH',15),('0016','CO. INC.',16),
  ('0017','S.R.L.',17),('0018','S.L.',18),('0019','CO.',19),('0020','BVBA',20),
  ('0021','G.P.',21),('0022','S.A.S.',22),('0023','B.V.',23),('0024','L.P.',24),
  ('0025','PLC',25),('0026','UAB',26),('0027','S.A.U.',27),('0028','S.L.U',28);

insert into md_vendor_type (code, name, sort_order) values
  ('0001','Raw Material',1),('0002','Packaging Material',2),('0003','Indirect Material',3);

insert into md_vendor_type_detail (code, name, vendor_type_code, sort_order) values
  ('0001','Packaging Primer','0002',1),
  ('0002','Packaging Sekunder','0002',2),
  ('0003','Raw Material','0001',3),
  ('0004','Barang Umum','0003',4),
  ('0005','Zakat & CSR','0003',5),
  ('0006','Media','0003',6),
  ('0007','CREM','0003',7);

insert into md_otv_status (code, name, sort_order) values
  ('C1','Reguler Vendor',1),('C0','One Time Vendor',2);

insert into md_vendor_direct_type (code, name, sort_order) values
  ('Z002','Direct Transaction',1),('Z009','Manufacturer',2);

insert into md_corporate_entity (code, name, interface_name, sort_order) values
  ('ID01','PT Paragon Universa Utama','Paragon Corp Indonesia',1),
  ('ID02','PT Paragon Technology And Innovation','Paragon Corp Indonesia',2),
  ('ID03','PT Parama Global Inspira','Paragon Corp Indonesia',3),
  ('ID04','PT Varcos Citra International','Paragon Corp Indonesia',4),
  ('ID05','PT Paranova Global Optima','Paragon Corp Indonesia',5),
  ('ID06','PT Alpha Global Medika','Paragon Corp Indonesia',6),
  ('MY01','PT Pharmacore Technology & Innovation','Paragon Corp Malaysia',7);

insert into md_transaction_type (code, name, provides_einvoice, sort_order) values
  ('T01','Goods',true,1),
  ('T02','CSR Cash Money',false,2),
  ('T03','Rent',false,3),
  ('T04','Other',false,4);

insert into md_tax_document_type (key, label, required, sort_order) values
  ('siup','SIUP',true,1),
  ('pkp','PKP',false,2),
  ('sbu','SBU',false,3),
  ('skb','SKB',false,4),
  ('suratKeteranganPp','Surat Keterangan PP',false,5),
  ('codCor','COD/COR',false,6);

insert into md_legal_document_type (key, label, doc_group, required, sort_order) values
  ('aktaPendirian','Akta Pendirian','upload',true,1),
  ('skPendirian','SK Pendirian MENKUMHAM','upload',true,2),
  ('aktaPerubahan','Akta Perubahan SK/SP MENKUMHAM','upload',false,3),
  ('aktaSusunanDireksi','Akta Susunan Direksi dan Komisaris SK MENKUMHAM','upload',false,4),
  ('nib','NIB','upload',true,5),
  ('suratIzinUsaha','Surat Izin Usaha / Sertifikat Standar','upload',false,6),
  ('izinLokasi','Izin Lokasi','upload',false,7),
  ('pkkpr','PKKPR','upload',false,8),
  ('suratKuasa','Surat Kuasa','upload',false,9),
  ('conflictOfInterest','Conflict of Interest','other',true,10),
  ('othersDocuments','Others documents (SPK, PU, dll)','other',false,11),
  ('deedOfEstablishment','Deed of Establishment (DoE)','other',false,12),
  ('businessLicense','Business License','other',true,13);

insert into md_license_type (key, label, sort_order) values
  ('gmp','GMP',1),('cpkb','CPKB',2),('halal','Sertifikat Halal',3);

insert into md_currency (code, name, sort_order) values
  ('IDR','Rupiah',1),('MYR','Ringgit Malaysia',2),('USD','Dolar Amerika Serikat',3),
  ('SGD','Dolar Singapura',4),('EUR','Euro',5);

insert into md_term_of_payment (code, name, days, sort_order) values
  ('D007','7 Days',7,1),('D014','14 Days',14,2),('D015','15 Days',15,3),
  ('D045','45 Days',45,4),('D060','60 Days',60,5),('D090','90 Days',90,6),
  ('D120','120 Days',120,7);

insert into md_fiscal_position (code, name, sort_order) values
  ('FP01','Absolut (PRM)',1),('FP02','Absolut (PTI)',2),('FP03','Free Trade Zone',3),
  ('FP04','Has NPWP no PKP',4),('FP05','Individual non NPWP',5);

insert into md_account_type (code, name, sort_order) values
  ('AT01','Virtual Account',1),('AT02','Bank Account',2),
  ('AT03','Batch Upload',3),('AT04','Billing ID',4);

insert into md_agreement_rate (code, name, sort_order) values
  ('active','Active',1),('inactive','Inactive',2);

insert into md_bank (code, name, bic, country, sort_order) values
  ('BMRI','Bank Mandiri','BMRIIDJA','Indonesia',1),
  ('BCA','Bank Central Asia','CENAIDJA','Indonesia',2),
  ('BNI','Bank Negara Indonesia','BNINIDJA','Indonesia',3),
  ('BRI','Bank Rakyat Indonesia','BRINIDJA','Indonesia',4),
  ('BNIA','Bank CIMB Niaga','BNIAIDJA','Indonesia',5),
  ('BDIN','Bank Danamon','BDINIDJA','Indonesia',6),
  ('BBBA','Bank Permata','BBBAIDJA','Indonesia',7),
  ('PINB','Bank Panin','PINBIDJA','Indonesia',8),
  ('IBBK','Bank Maybank Indonesia','IBBKIDJA','Indonesia',9),
  ('NISP','Bank OCBC NISP','NISPIDJA','Indonesia',10),
  ('BSMD','Bank Syariah Indonesia','BSMDIDJA','Indonesia',11),
  ('MBBE','Maybank','MBBEMYKL','Malaysia',12),
  ('CIBB','CIMB Bank Berhad','CIBBMYKL','Malaysia',13),
  ('PBBE','Public Bank Berhad','PBBEMYKL','Malaysia',14),
  ('RHBB','RHB Bank Berhad','RHBBMYKL','Malaysia',15),
  ('HLBB','Hong Leong Bank','HLBBMYKL','Malaysia',16),
  ('DBSS','DBS Bank','DBSSSGSG','Singapura',17),
  ('OCBC','OCBC Bank','OCBCSGSG','Singapura',18),
  ('UOVB','United Overseas Bank','UOVBSGSG','Singapura',19),
  ('HBUK','HSBC Bank','HBUKGB4B','Britania Raya',20),
  ('SCBL','Standard Chartered Bank','SCBLGB2L','Britania Raya',21),
  ('BARC','Barclays Bank','BARCGB22','Britania Raya',22),
  ('CITI','Citibank','CITIUS33','Amerika Serikat',23),
  ('CHAS','JPMorgan Chase Bank','CHASUS33','Amerika Serikat',24),
  ('BOFA','Bank of America','BOFAUS3N','Amerika Serikat',25),
  ('DEUT','Deutsche Bank','DEUTDEFF','Jerman',26),
  ('BNPA','BNP Paribas','BNPAFRPP','Prancis',27),
  ('BOTK','MUFG Bank','BOTKJPJT','Jepang',28),
  ('SMBC','Sumitomo Mitsui Banking Corporation','SMBCJPJT','Jepang',29),
  ('BKCH','Bank of China','BKCHCNBJ','Tiongkok',30);

insert into md_question_type (key,label,type_group,has_options,scorable,value_kind,sort_order) values
  ('short_text','Teks pendek','text',false,false,'text',1),
  ('long_text','Teks panjang','text',false,false,'text',2),
  ('single_choice','Pilihan tunggal','choice',true,true,'text',3),
  ('multi_choice','Pilihan ganda','choice',true,true,'array',4),
  ('dropdown','Dropdown','choice',true,true,'text',5),
  ('yes_no','Ya / Tidak','choice',true,true,'text',6),
  ('yes_no_na','Ya / Tidak / N/A','choice',true,true,'text',7),
  ('number','Angka','number',false,false,'number',8),
  ('percentage','Persentase','number',false,false,'number',9),
  ('currency','Mata uang','number',false,false,'number',10),
  ('date','Tanggal','date',false,false,'date',11),
  ('date_range','Rentang tanggal','date',false,false,'object',12),
  ('file_upload','Unggah berkas','file',false,false,'array',13),
  ('rating','Penilaian bintang','rating',false,true,'number',14),
  ('score','Skor','rating',false,true,'number',15),
  ('statement','Pernyataan','special',false,false,'boolean',16),
  ('signature','Tanda tangan','special',false,false,'object',17),
  ('matrix','Tabel / matriks','special',true,false,'object',18);
