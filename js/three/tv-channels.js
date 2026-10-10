// ЖК VILNYI (Ужгород) — the TV channels of the flats (V19, owner's instructions of 10 October, v0.7). Loaded with home-media.js.
// ONLY official, legally embeddable sources: each channel is the broadcaster's own verified YouTube channel, played through the
// standard privacy-enhanced YouTube embed. No IPTV, no re-streams. Checked 2026-10-10 (yt-dlp from a sandbox with internet:
// channel id, verified badge, follower count, live state, playable_in_embed; oEmbed 200 for every Kvartal 95 episode):
//   live    → embed/live_stream?channel=<id> (the channel's current official live broadcast); if YouTube reports an error
//             (no live broadcast at that moment / not embeddable) the TV falls back to the same channel's uploads playlist
//   uploads → embed/videoseries?list=UU<id> (the channel's own latest uploads: no live broadcast when checked)
//   k95     → «Квартал 95»: a DIFFERENT full episode in every flat — K95_EPISODES[index of the flat in UNITS] (462 flats,
//             553 episodes): full-length (≥ 20 min) uploads with Ukrainian titles from the official channel
//             «Студія Квартал 95 Online» (@studiya95kvartal, UCfCVlxInB4VuaDFLGqEQqaA), newest first, each embeddable.
export const CHECKED = '2026-10-10';
export const CHANNELS = [
  { n: 1, name: 'Суспільне Новини', id: 'UCPY6gj8G7dqwPxg9KwHrj5Q', handle: '@SuspilneNews', mode: 'live' },
  { n: 2, name: '1+1', id: 'UCVEaAWKfv7fE1c-ZuBs7TKQ', handle: '@1plus1', mode: 'live' },
  { n: 3, name: 'ТСН · Єдині новини', id: 'UCXoJ8kY9zpLBEz-8saaT3ew', handle: '@tsn', mode: 'live' },
  { n: 4, name: 'ICTV', id: 'UCa85JIfBxZgcrsd8Ar7Z9nw', handle: '@ictv', mode: 'live' },
  { n: 5, name: 'СТБ', id: 'UCrb7XNZEwPheovXjgbkH5vg', handle: '@Telekanal_STB', mode: 'live' },
  { n: 6, name: 'Новий канал', id: 'UCAptZHV2-xkB4GJGgSKRsHQ', handle: '@novy_channel', mode: 'live' },
  { n: 7, name: 'ТЕТ', id: 'UCzBdhZzaL63vQ6FdGFRvtcA', handle: '@tet', mode: 'uploads' },
  { n: 8, name: '2+2', id: 'UC0rUcXe-tsu_MA33brxjDNg', handle: '@2plus2', mode: 'uploads' },
  { n: 9, name: 'Квартал 95', id: 'UCfCVlxInB4VuaDFLGqEQqaA', handle: '@studiya95kvartal', mode: 'k95' },
  { n: 10, name: 'Рада', id: 'UC5V8mErVFOpcQXEb3y9IMZw', handle: '@RadaTVchannel', mode: 'live' },
  { n: 11, name: '5 канал', id: 'UCkyrSWEcjZKpIwMxiPfOcgg', handle: '@5channel', mode: 'live' },
  { n: 12, name: 'Прямий', id: 'UCH9H_b9oJtSHBovh94yB5HA', handle: '@pryamiy', mode: 'live' },
  { n: 13, name: 'Еспресо', id: 'UCMEiyV8N2J93GdPNltPYM6w', handle: '@EspresoTv', mode: 'live' },
  { n: 14, name: '24 Канал', id: 'UCja992VI_u2e52c9FHQXw5A', handle: '@24онлайн', mode: 'live' },
  { n: 15, name: 'Суспільне Спорт', id: 'UCXZ4rKdpxhnhi5U4fEcJayQ', handle: '@SuspilneSport', mode: 'uploads' },
  { n: 16, name: 'Суспільне Культура', id: 'UCpzZB5rRJ0W7KzjVvfbMxew', handle: '@SuspilneKultura', mode: 'uploads' },
  { n: 17, name: 'Суспільне Ужгород', id: 'UC-OzzdirrCOWniXVuyJS5Fw', handle: '@SuspilneUzhhorod', mode: 'uploads' },
];
export const K95_CHANNEL = 9;
export const K95_EPISODES = [
  'QwFHpaqdUAA,tAY-gjHFMRo,T_CBwubpt_I,ZUNphN7k9JI,J1IpaUzonWg,s4xZps5UN58,VJmqjY5aiY4,YMZSOlyrYhk,eFdq5Q4XwMk,FsxCUj4ElRE,JzmbpEhujgo,M3Z3sj0I3Jg',
  'ayQcdSyRIf0,0kcZKzL-T_g,GqWpukg0uLA,ibRS29hu6ho,znDRF4KbYhI,X7bMB7pev-o,F5PE7G_HBtE,SUbPEpPJudc,Wo5BClOBRZc,Pw9sZNNXWHs,BrjFwDEsSK4,IdRGmHZaBx8',
  'jNaaR9O4xlo,ImZsg6Ttlz8,jQpju_z_9VA,t_LeLplB4qk,kwei1LB-lFI,yHRUkk7Q_ZU,tnV4Sg4B3dI,z4O6CpiXOhs,UHiWKMlqObE,OOQbpZanb58,Dv1eiE9Xv8o,E3decow9voU',
  'Io2qeQOWXJA,pwbKrLMii0I,xdPgNRgn7rA,h2E_ROXo0uE,uMt3KDxVjCY,2iSKnVro5jE,QdyQfm6TAb4,8VjRexxDKyA,oQkwaQ_puYI,XpPoV-ifosM,PPdZwfZhD7A,HumJESyU-zE',
  '0EB2J6kc3DA,-ZXvxHktQ-8,YkkQZRPT2Ck,SJoNsqMLthQ,RXKBhO3BZLE,9r0OmnNrJME,XX8LPIV5zFY,hK9evI7fgGc,JtAFuD8RBDs,5xR196G8HGM,RsGfMWdlxhk,R4WqvuppejA',
  'HslF_lV5d3o,EIG6RwvoPFk,0iTXe9f4-ho,uOehc3c1nb0,dGw5Bv7EFlM,-eutiXwRk38,6nZg6_WnuFI,5lEzQBX1ue8,nUi5h1XRZlM,9R_BMlTrR2I,1GedCVNpRBk,o_UPeAUWTc4',
  'YLe48-vS7RI,UllqUf-ICaE,3mw7ptWYtnw,s6Fw28ulrw4,O3RXt47WEng,VmetQREK4N8,AhbnbmXTz8s,r3zIbHrHWu4,SRd3ofHn5WY,fT9vv0oE47I,EjLlIkoFJGQ,WDSoQwkScOI',
  'gJlvNywuoxw,PQe0HzIRksg,6u8Z00KpJIg,6GatsiPAS_U,mb2aqyJ14gc,wgx_ckOny7I,XWqgFRbjWQk,K8qGhC1J1tU,ihnn9XwfKoY,bytLT5-f890,6IDvK-pMj08,kiR76MlqqhQ',
  'nbJSjQEFXcc,Y2GYvVUC7HA,6LidtBdDtEA,HQjNN1Docso,4zUbRS-djZ0,t6OgfdO-gGU,17oX_rdS2Zc,nUrKv-Em6zU,7Guzbm15iJQ,PidAq3wQIvo,AVO3gfbFMSw,3CTs7-x1H2g',
  'ku-GDzZMt3g,zuL7Vs1BVD8,2fqB-FmtcPE,VRZAmUFdTHM,XT3jU4j-ykc,gY5V-8uJQco,WtWsy9UyR8s,22hgG2X7MPo,OXOF_p3gVmU,hCI1QXDpbG4,IofBZXSGSQ8,nc9LeMAkGYY',
  'N9INeBOwxZM,DImf8qA0Lew,SHakveSh5Xo,tkleoj9huj4,z7C1FHZtnvY,16AeQBjl75E,JYLXuigPB7E,xnaJ3lf66sE,AW8lKLrsPVc,yeQaS12L4Bk,a5HSkFw0q0E,_nfC-MKBjOc',
  '00A5nVkUrpk,8rF_H6XLiA0,hrpNXbDZuxE,JmuSmRxWdGg,WM04ckh4bx8,_J8Cppu1l8c,4Zes9kT_OvM,wBhkLxPXEVc,hL_XjtfLrqs,GOSGi3FwbNg,CZozzA6S_IQ,wdAAMssSRe0',
  'CTWORSSK9jQ,u_mQI5hGsc4,xIdffjE9Wbg,Yz01MCs0vB8,yJhgoJfAr9M,jv88fqvDXfQ,qmUaZp7GxUA,ILbIMQfJ_Co,MKHT2aJ3MQ0,ILRKaYgLUNo,D8tOwsbHbjw,zco4pftPyF4',
  '6RnfXFt3QPw,Jjb6vHPObgk,fdtsEOqyN6Y,e76Ml2jnO-Q,2o5ZkPLU6zc,Jg3MkRiQE7E,iIv7DVdBxOA,JqhARRvWqeA,9mqng26Dovo,yVF1KtC-a5s,R1wolYSpXIs,IY_A-YmCorI',
  'QJoZwY1gSc8,3XgZSeIwvqU,SsAvECZ7jYo,ryOu_lh9OHQ,xcr-GGH3pLA,utBUhQ2hTAQ,gMSk1J3mqtE,PvzLOH1qaNo,kHCqKNoJ_zY,LFDpqrmZnKM,byfRhrch7XM,z5-mg28cu_Y',
  'xrTDkj3znuY,g-BtHHqd3Aw,HZjIxXfTFwI,xyFHobQGogM,sd95GVWD0eM,nH1zyhx61sw,1rv6pc-JFDg,p2kR1cvW3GQ,B6889vV7ez0,h9ekyMiiDIg,hot8NFR1KGQ,qVQGd_oqFD8',
  'Wxz-IXzS83E,EYy-W2laqyA,9wccOrDGkio,pMmGbyBQfDg,NHgRc-GY8lI,c_AVh4C22Yo,eZTs53gcVww,mXs79uVeQ98,-keGaoVCl7o,iTlKIRqsmco,q1KITppQZcw,KyeTMQyQpKI',
  'es4twMNJnjQ,V1YxE9UK_zg,4Sj1sWJ4C0c,7AyqWBPYgsU,PkBWXOs-N0o,HXB0byjTuAI,5_TISpgKdxw,yW-W8jM9IOg,Sksk5QEkTqc,kmtJ7l6l5Z8,UUwY6LzPhCI,MRwt0c7-7MQ',
  'EOSR91S0cyY,OvSyJAVOQHo,nn7Vt9zQBwc,9mP7WYCrExo,UtExNj7BERo,cR3Ju6_rgrg,zFjqZJ3NH34,cis2EUxhqk8,pfH8FDMWCm4,FxUqRG8aZcQ,8i1lKk0a5LQ,XiIg-vXKOk4',
  'LYqzGDEAG38,jyDb9Gy2ejk,oc_UgyM91rI,Z8T8orJt7hk,1Q0KY_7NnXU,Jv7EW_rEK1Y,0nEygf559jI,3FCQr8BcHxo,5ROvMVeCAsg,c9TlMTQp5wk,FVFQUzqAOsA,byKpksq4vHY',
  'IFlsEFpcaAI,CSdSXZLQ0ys,2nn3_uXbYGI,MSSA02e1Lm4,-p3nJk5lwEU,jaSMUJv3JtE,fMYfNvHjL_k,FLyNks2-jIY,tMZtxLYseXA,8tAJy3X3Kro,FKK4BdcWbjs,o0jwAcDl6tY',
  'h_iTMcv9zpQ,QB5ZrNIPfo4,fR92OzsUSpc,ARrHml_RABM,sqEP1xZT75A,8fVM2sJegZk,lOgWibiZi48,pg_7HsK6Jrk,KVJ_2TjtHBU,fW0jqLouAMk,bzrdbyPaz58,PeV1hGj85YI',
  'rfNdN1YbKYM,XL5JELZVNAI,jENMDq1xLcE,W3v_WyeGHGc,hjFIOCO0PH8,d-6tIRpYUyk,PbvZSHdcl2s,AuNzTxT71hg,V98n83JFYuY,rqjv5n44OLk,sovRyt2yWno,9eBlfrkYJVc',
  'VmvoFBOOaUs,6sf9drszXlQ,F4zPWjyPtqA,46fm91CbuR4,U_XqBWNiFzI,ZRtEfpLRGJg,YC0CF282ddk,-2hZNh1h_Lg,eyxnGc4sws0,KrPGKAhI4eA,0ACSec44rOc,exJgDKk-lmA',
  'yNnO-sX2-Go,4ulB2R8eLn4,V-57pk1qz-I,LVCI-N_WrCQ,4p0_gFJHhkk,6sZFhVm8Xu8,xySM69f2WOQ,WjSaWWweYM0,znwe3K8_EYU,VTX9EA3_Crc,9e9evTt0rYs,kGvfLe11uvc',
  'G-QlECaMprw,eieTzg49w8w,Ewg6SN9mwxw,TOWH7N_dCZY,H3D_hCo31Ag,UEWRCsiFV9M,GH6nccIkajE,UGAX77NMNnQ,vwv_UDLh5S0,lhM3fy3yA0c,3wPfzRJohKE,lAfle-lvklA',
  'Pr0kToYKWgA,BHCyUaL07qo,UuLqKendJiM,wY9PiuzJGas,lT9tzUunrFY,yDGXJRczs2I,wvRGqsdW5dU,Vue7CZLIRRw,VgYJk16OtUA,wOUlQrN_0HY,3XMfWP6D5BA,VXIA2ylwEd0',
  'SLC7U4kX75c,NuIv2CVyP3E,HZ6DTQGA7go,mlPp9HLw5MI,mFZMo1bLhYM,DSUsW_qLsMw,KChJ0RY4s-o,j9NKe2aH-0g,8bfLwQX8-R0,QmccQsc76o4,9JmXKNjej0Q,djot77zAxqY',
  '-u3doHCds-k,LJsIdLFVo7E,FifNEhhMmAs,UWdqeBCIhiI,OVgFSsOK06A,0VlxFbfTdZs,M10Glf8P-ds,3zbBnOAwP2Q,_lKi5_qnCwk,043mrfA9qJ4,SeYIXRYBxiU,SP3VzRUK7ag',
  'aFs8ewffcEE,5sOm797lOyw,Myih1mup6ek,IXnQDD1pxmA,gcBNAOQpzrY,qpwHnhThe50,ke4_jSvod34,bL5hkO-gHQw,eKsnYf6NAGU,oQ7VmtU1mv8,1KQeI-opIFc,1xH4RnP6fNw',
  'fBdEotZhpps,JbEFuves17E,eTy1wSW7tck,2q5eOEvQb84,vws03EVt2pc,YNECmIHcHRY,ZyCwlevRUyU,TVtv5px0i8Q,IbdO2-8gx88,VwrhqhIdw14,yRE9UH3wRyI,5yruKbee5ow',
  '1_DAzoSzoC0,XfN4NrdijaE,pk_FUyk3DNc,l5Gn4m1vL8I,Vf2wTQJLSbo,eJNFmHmSkrU,671KsT_quxE,2mnmaj3810U,TivjweiCwhE,EeJrCTYNJ3Q,BsU1enRWmws,d0wPWJia3Yk',
  'mmw6-TFm1nk,T77wNvMzRBg,JDtTgi1CIos,GE4cUdhZws4,csUPWCnrRHQ,Ru4TcbpXdCE,23bKegAd_PM,fnfv6JFVpHc,5a8hngfuCLo,l0l9LeA5Bu0,S9iClvW85JY,3GRU_srwlUY',
  'O1tZygmZscA,b7WZWsnfXWI,2BQB6Bk8hdQ,Ce-xVYj8-Gw,1aXi-mjgxsY,KCWsosu6B8A,rLgNbtTpmvI,vYsqxI5FOok,7qtYaYipNh8,tOcIyR-kID0,N-A3XkDNsYo,v57Wy6Vfcrw',
  'mRyunOcLEjw,Y7jhCj-mOAY,T-MT9Do1zFw,26oGcWL2qRE,0x3TsdmxOzM,G9izYijLX2o,dHLQg_MGhkA,KOFHBecLVWg,nLnJdZwJB4Q,LFsfKduV5tE,4K5F2G9pqdc,_Gmtu4Cb15I',
  '062uMegVEPI,_9ZgX2bair0,KPXuzblqqYs,FURtu0Za6EE,XemGObKTF0o,ud-E2Jz64vM,RNCCpEzl1NY,DGkvuEBkmG4,hqK9NjlH8E0,WuUQDvKEduk,ef9tKP_EVp4,lPouyjj5oA4',
  'iNca2est6UU,JnhI1Ey96O8,RE7FpstZbMA,oubsIBu7sQ4,jVfICzkazX4,gXOuApyXpNI,g7bv7LUUhO4,fcgTgqZfpy8,Ct5OhdpJNDQ,PhyZAAO-QzY,ZoiG-0r7Gxs,ETO6ZhrG6nI',
  'MFOoELBlqDY,DsSrInAqAy8,H_l3r6ZdrbM,gfRyenXRN1Q,b5G6FVebNdQ,2xtqgSQRj_A,k192U9mQWCE,Hy1l0YIOWpY,FgYIFMPXVzs,8aCBtZbs4qI,vY9P_mtWMZo,qimmKpwHZLY',
  '4oAPy_cg3wc,ea9xYoKrbTY,aaab6kn6Lak,vZLMI504Xko,mYlfqc9Gvwc,31KcumHraYk,7X6OWepQkEk,j1z9M5k5a8o,dGdSTzc3Dmg,DfQPSPqP22s,qu54FM_fXTM,jvuIrM1PMw4',
  'I1XQI-_Gce4,pGhFdBqnyQo,k0ba8cov1RI,da6ouzRUbKw,3BqwtCYqXEI,-xiItZfQsq8,vx8c8rtayrI,--z7d4UnqW8,RZNQNYzOeHs,_b3VU7fFWHc,ZkmAcZn-C7g,nLzRtQY-7MQ',
  '-he6xq5SZPI,m-aY4qKMW48,sMKcrhMAFfY,xrFuvXUuyiQ,rPHVfvA3sww,fk-ZnJQOqSw,rOrB8Qw6KDM,ROuBX8Z5uu0,Acjm02baajE,9VPSKQLdOKM,o8_azEnOGlI,5qUpnaAMzzs',
  '3O6KlDBTs8E,br2iq1g2Nqs,YbMQHb-Kr3s,cO31klB3X3s,yP7EnQ-0v4c,dgU4MtoH5jA,Kz0w5pxTei8,UZFi69bpcno,xBY78MMYHW8,3ImADw_qksY,cIPu_9hOGwU,Q0mU_LC_GEE',
  'NpqIdX6teBY,kf5VGSjZeBk,VXasoRYovJk,k6HRLITAbpE,jMRpG3fQum8,uCGTutvuVVA,Pjz4sC2WCss,m84z7dA79Ow,OfCA-sU3UvE,WxmsVLal5Is,b36_58FoxFQ,lNMohsz4lMQ',
  'kP8FX6eu5VQ,8vJKvHGRjiE,Rvs6hXW-BPk,mc8tVFC-Jhg,xDInOLqzOtY,jF5204vI1RI,vc1S8PD6ocI,EThr8eSZ04w,0ndojC0-SOY,RGNiMilF9Tc,z3FZ9ycxFko,lL0QChImoAI',
  'BkhUD-R9AAM,w-fOWS2iFgU,Mwsbhx9hrRA,OxYzBQHmZ7k,SQoEth9ijEg,jytApr6NtFs,bbM5WxlD5n0,CgM72f5v76c,Zi-_4R7gNxA,YWRDBjQzn1Q,7NhGc3Sm-gM,_mPb8K7tePU',
  'ujBl2g-05kY,O8JSbts6lIE,hGTixFQjcco,tsMawrkmrtk,XzkDAt0o3cc,6UWrdyHYZOQ,KQF06uwhoZ4,Mh6gaQt9kmA,BsOWpmkBWwA,znooc1-Iguo,xqEx_M5yD3Q,AYBOWAHbW-U',
  'Nuah3Bzq4uc',
].join(',').split(',');

/** the Kvartal 95 episode of a flat: index of the flat in UNITS (stable, all 462 different) */
export function k95Episode(unitIndex) { const n = K95_EPISODES.length; return K95_EPISODES[((unitIndex % n) + n) % n]; }

const Q = 'autoplay=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1';
/** embed URL of channel `ch` ({ unitIndex } for Kvartal 95); fallback = the uploads playlist instead of the live broadcast */
export function channelUrl(ch, { unitIndex = 0, mute = true, controls = false, fallback = false, origin = '' } = {}) {
  const base = 'https://www.youtube-nocookie.com/embed/', o = origin ? '&origin=' + encodeURIComponent(origin) : '', q = `${Q}&mute=${mute ? 1 : 0}&controls=${controls ? 1 : 0}${o}`;
  if (ch.mode === 'k95') { const v = k95Episode(unitIndex); return `${base}${v}?${q}&loop=1&playlist=${v}`; }
  if (ch.mode === 'live' && !fallback) return `${base}live_stream?channel=${ch.id}&${q}`;
  return `${base}videoseries?list=UU${ch.id.slice(2)}&${q}`;
}
export const channelPage = (ch) => 'https://www.youtube.com/channel/' + ch.id + (ch.mode === 'live' ? '/live' : '');
