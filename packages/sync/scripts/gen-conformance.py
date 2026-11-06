import os
# 共通テストの JSON を作る。暗号の期待値は noble・BouncyCastle と別の実装(Python の hashlib・cryptography)で求める
import json, hashlib, hmac as H, base64, struct, sys
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','conformance','')
hx=lambda b:b.hex()
def hkdf(ikm,salt,info,l):
    prk=H.new(salt or bytes(32),ikm,hashlib.sha256).digest(); t=b'';o=b'';i=1
    while len(o)<l: t=H.new(prk,t+info+bytes([i]),hashlib.sha256).digest(); o+=t; i+=1
    return o[:l]
def rotl(x,n): return ((x<<n)&0xffffffff)|(x>>(32-n))
def hchacha(key,n):
    s=[0x61707865,0x3320646e,0x79622d32,0x6b206574]+list(struct.unpack('<8I',key))+list(struct.unpack('<4I',n))
    def q(a,b,c,d):
        s[a]=(s[a]+s[b])&0xffffffff; s[d]=rotl(s[d]^s[a],16)
        s[c]=(s[c]+s[d])&0xffffffff; s[b]=rotl(s[b]^s[c],12)
        s[a]=(s[a]+s[b])&0xffffffff; s[d]=rotl(s[d]^s[a],8)
        s[c]=(s[c]+s[d])&0xffffffff; s[b]=rotl(s[b]^s[c],7)
    for _ in range(10):
        q(0,4,8,12);q(1,5,9,13);q(2,6,10,14);q(3,7,11,15);q(0,5,10,15);q(1,6,11,12);q(2,7,8,13);q(3,4,9,14)
    return struct.pack('<8I',*(s[:4]+s[12:]))
def xseal(key,nonce,pt,aad):
    return ChaCha20Poly1305(hchacha(key,nonce[:16])).encrypt(b'\0\0\0\0'+nonce[16:],pt,aad)
def pad(b):
    return b+b'\x80'+bytes(((len(b)//256+1)*256)-len(b)-1)
b64=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def C(name,inp,exp,**kw): return dict(name=name,input=inp,expected=exp,**kw)
cry=[]
cry.append(C('SHA-256 FIPS 180-2 の "abc"',dict(fn='sha256',data=hx(b'abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
cry.append(C('HMAC RFC 4231 テスト 1',dict(fn='hmac',key='0b'*20,data=hx(b'Hi There')),'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'))
cry.append(C('HMAC RFC 4231 テスト 2',dict(fn='hmac',key=hx(b'Jefe'),data=hx(b'what do ya want for nothing?')),'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'))
cry.append(C('HKDF RFC 5869 テスト 1',dict(fn='hkdf',ikm='0b'*22,salt='000102030405060708090a0b0c',info='f0f1f2f3f4f5f6f7f8f9',length=42),'3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'))
cry.append(C('HKDF RFC 5869 テスト 3(salt・info が空)',dict(fn='hkdf',ikm='0b'*22,salt='',info='',length=42),'8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8'))
ok=bytes(range(32)); hn=bytes.fromhex('000000090000004a0000000031415927')
hexpected='82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc'
assert hx(hchacha(ok,hn))==hexpected
cry.append(C('HChaCha20 draft-irtf-cfrg-xchacha 2.2.1',dict(fn='hchacha20',key=hx(ok),nonce=hx(hn)),hexpected,only='android'))
vk=bytes(range(0x80,0xa0)); vn=bytes(range(0x40,0x58)); va=bytes.fromhex('50515253c0c1c2c3c4c5c6c7')
vp=b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
vc='bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e'+'c0875924c1c7987947deafd8780acf49'
assert hx(xseal(vk,vn,vp,va))==vc
cry.append(C('XChaCha20-Poly1305 draft-irtf-cfrg-xchacha A.3.1',dict(fn='xchacha_open',key=hx(vk),nonce=hx(vn),aad=hx(va),ciphertext=vc),hx(vp)))
cry.append(C('XChaCha20-Poly1305: タグを 1 ビット変えると失敗',dict(fn='xchacha_open',key=hx(vk),nonce=hx(vn),aad=hx(va),ciphertext=vc[:-1]+('8' if vc[-1]=='9' else '9')),dict(error='decrypt_failed')))
cry.append(C('XChaCha20-Poly1305: AAD が違うと失敗',dict(fn='xchacha_open',key=hx(vk),nonce=hx(vn),aad='',ciphertext=vc),dict(error='decrypt_failed')))
cry.append(C('XChaCha20-Poly1305: ノンスが 12 バイトは拒否',dict(fn='xchacha_open',key=hx(vk),nonce='00'*12,aad='',ciphertext=vc),dict(error='bad_nonce')))
for n,e in [(0,256),(1,256),(255,256),(256,512),(257,512)]:
    cry.append(C(f'埋め草: {n} バイトは {e} バイト',dict(fn='pad',length=n),e))
cry.append(C('埋め草: 形',dict(fn='pad_bytes',plain='414243'),'41424380'+'00'*252))
cry.append(C('埋め草を外す',dict(fn='unpad',padded='41424380'+'00'*252),'414243'))
cry.append(C('埋め草を外す: 空の平文',dict(fn='unpad',padded='80'+'00'*255),''))
cry.append(C('埋め草を外す: 平文の末尾の 0x80 と 0 を消さない',dict(fn='unpad',padded='41800000'+'80'+'00'*251),'41800000'))
cry.append(C('埋め草を外す: 目印がない',dict(fn='unpad',padded='00'*256),dict(error='bad_padding')))
cry.append(C('埋め草を外す: 目印の後に 0 以外',dict(fn='unpad',padded='80'+'00'*254+'01'),dict(error='bad_padding')))
cry.append(C('埋め草を外す: 256 の倍数でない',dict(fn='unpad',padded='80'+'00'*254),dict(error='bad_padding')))
cry.append(C('埋め草を外す: 空',dict(fn='unpad',padded=''),dict(error='bad_padding')))
sp='ab'*32; ri='cd'*32
goodctx=dict(space_id=sp,record_id=ri,kind_tag='h',schema_version=1)
cry.append(C('AAD の形は space_id|record_id|kind_tag|schema_version',dict(fn='aad',ctx=goodctx),hx(f'{sp}|{ri}|h|1'.encode())))
cry.append(C('AAD: 権限系',dict(fn='aad',ctx=dict(goodctx,kind_tag='s',schema_version=12)),hx(f'{sp}|{ri}|s|12'.encode())))
for nm,c in [('区切りを混ぜた record_id',dict(goodctx,record_id=ri+'|h')),('大文字の space_id',dict(goodctx,space_id='AB'*32)),('知らない kind_tag',dict(goodctx,kind_tag='x')),('負の schema_version',dict(goodctx,schema_version=-1)),('小数の schema_version',dict(goodctx,schema_version=1.5))]:
    cry.append(C(f'AAD: {nm}は拒否',dict(fn='aad',ctx=c),dict(error='bad_aad')))
cry.append(C('Base64URL: 書く',dict(fn='b64url_encode',data='fbff00'),'-_8A'))
cry.append(C('Base64URL: 読む',dict(fn='b64url_decode',text='-_8A'),'fbff00'))
cry.append(C('Base64URL: 埋めなしの短い形',dict(fn='b64url_decode',text='_w'),'ff'))
for t in ['-_8A=','+/8A','_x','a','a b']:
    cry.append(C(f'Base64URL: {t!r} は拒否',dict(fn='b64url_decode',text=t),dict(error='bad_encoding')))
K=bytes(range(0x20,0x40))
d=lambda i:hkdf(K,b'',i.encode(),32)
keys=dict(auth_token=d('obb-sync/auth'),k_data=d('obb-sync/data'),k_secret=d('obb-sync/secret'),k_id=d('obb-sync/record-id'))
space=hashlib.sha256(keys['auth_token']).hexdigest()
cry.append(C('鍵の導出と space_id',dict(fn='derive_keys',k=hx(K)),dict(**{k:hx(v) for k,v in keys.items()},space_id=space)))
cry.append(C('鍵の導出: 31 バイトは拒否',dict(fn='derive_keys',k='00'*31),dict(error='bad_key')))
rid=H.new(keys['k_id'],b'favorite:eagle.5ch.io/x/:1700000000',hashlib.sha256).hexdigest()
n1=bytes(range(24)); 
def rec(pt_bytes,kind='h',key=None,rid=rid,ver=3,sv=1,padit=True,nonce=n1):
    key=key or (keys['k_secret'] if kind=='s' else keys['k_data'])
    aad=f'{space}|{rid}|{kind}|{sv}'.encode()
    return dict(record_id=rid,version=ver,kind_tag=kind,schema_version=sv,deleted=False,nonce=b64(nonce),ciphertext=b64(xseal(key,nonce,pad(pt_bytes) if padit else pt_bytes,aad)))
good={"body":{"board_url":"https://eagle.5ch.io/x/","future":{"a":[1,"ひ"]},"title":"スレタイ"},"device_id":"d0","future_top":True,"hlc":"000000000001.0000.d0","kind":"favorite"}
goodb=json.dumps(good,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
r0=rec(goodb)
ctx0=dict(space_id=space,record_id=rid,kind_tag='h',schema_version=1)
cry.append(C('レコードを開く',dict(fn='open_record',key=hx(keys['k_data']),ctx=ctx0,nonce=hx(n1),ciphertext=hx(base64.urlsafe_b64decode(r0['ciphertext']+'=='*(len(r0['ciphertext'])%4!=0)))),hx(goodb)))
ct0=base64.urlsafe_b64decode(r0['ciphertext']+'=='*(len(r0['ciphertext'])%4!=0))
cry.append(C('レコードを開く: 別の record_id の AAD では失敗',dict(fn='open_record',key=hx(keys['k_data']),ctx=dict(ctx0,record_id='ee'*32),nonce=hx(n1),ciphertext=hx(ct0)),dict(error='decrypt_failed')))
cry.append(C('レコードを開く: 別の schema_version の AAD では失敗',dict(fn='open_record',key=hx(keys['k_data']),ctx=dict(ctx0,schema_version=2),nonce=hx(n1),ciphertext=hx(ct0)),dict(error='decrypt_failed')))
cry.append(C('レコードを開く: 256 の単位でない長さは復号しない',dict(fn='open_record',key=hx(keys['k_data']),ctx=ctx0,nonce=hx(n1),ciphertext='00'*100),dict(error='bad_length')))
cry.append(C('レコードを開く: 16KB を超える長さは復号しない',dict(fn='open_record',key=hx(keys['k_data']),ctx=ctx0,nonce=hx(n1),ciphertext='00'*(16*1024+256+16)),dict(error='bad_length')))
# 壊れたものが混ざっても、ほかを止めない
rs=[r0,
    dict(r0,record_id='ee'*32),
    rec(goodb,kind='s',key=keys['k_data']),
    rec(b'\x41'*256,padit=False),
    rec(b'{not json'),
    rec(bytes([0xff,0xfe])),
    rec(b'\xef\xbb\xbf'+goodb),
    rec(b"{'kind':'favorite'}"),
    rec(b'['*40+b']'*40),
    rec(json.dumps(dict(good,hlc='bad')).encode()),
    rec(json.dumps(dict(good,body=dict(good['body'],board_url='javascript:alert(1)'))).encode()),
    dict(r0,nonce=b64(bytes(12))),
    dict(r0,version=-1),
    {'record_id':'zz'},
    None,
    rec(goodb,rid='11'*32,ver=7,nonce=bytes(range(24,48))),
    ]
exp=dict(records=[dict(record_id=rid,version=3,payload=good),dict(record_id='11'*32,version=7,payload=good)],
  failed=[dict(record_id='ee'*32,reason='decrypt'),dict(record_id=rid,reason='decrypt'),dict(record_id=rid,reason='padding'),dict(record_id=rid,reason='json'),dict(record_id=rid,reason='json'),dict(record_id=rid,reason='json'),dict(record_id=rid,reason='json'),dict(record_id=rid,reason='json'),dict(record_id=rid,reason='schema'),dict(record_id=rid,reason='schema'),dict(record_id=rid,reason='shape'),dict(record_id=rid,reason='shape'),dict(record_id=None,reason='shape'),dict(record_id=None,reason='shape')])
cry.append(C('まとめて開く: 壊れたものだけ捨てて数える',dict(fn='open_records',k=hx(K),space_id=space,records=rs),exp))
# 実行した実装の暗号文を相手が開けるか。TS・Kotlin の本番の seal で作ったものを、あとから足す
extra=json.load(open(sys.argv[1])) if len(sys.argv)>1 else []
for e in extra:
    cry.append(C(e['name'],dict(fn='open_records',k=hx(K),space_id=space,records=[e['record']]),dict(records=[dict(record_id=rid,version=1,payload=good)],failed=[])))

ids=[]
def B(n,u,e): ids.append(C(n,dict(fn='board',url=u),e))
B('https はそのまま(スキームを除く)','https://eagle.5ch.io/x/','eagle.5ch.io/x/')
B('5ch.net と 5ch.io は同じ','https://eagle.5ch.net/x/','eagle.5ch.io/x/')
B('http と https は同じ','http://eagle.5ch.io/x/','eagle.5ch.io/x/')
B('http の 5ch.net','http://eagle.5ch.net/x/','eagle.5ch.io/x/')
B('末尾の / がなくても同じ','https://eagle.5ch.io/x','eagle.5ch.io/x/')
B('大文字のホスト','HTTPS://Eagle.5CH.NET/x/','eagle.5ch.io/x/')
B('道の大文字は板の名前なので変えない','https://example.com/Board/','example.com/Board/')
B('道のある板','https://example.com/bbs/x/','example.com/bbs/x/')
B('道のある板で末尾の / がない','http://example.com/bbs/x','example.com/bbs/x/')
B('5ch 以外の http','http://jbbs.shitaraba.net/game/1234/','jbbs.shitaraba.net/game/1234/')
B('bbspink','http://mercury.bbspink.com/x/','mercury.bbspink.com/x/')
B('5ch.net の前に別の名前が付いたものは変えない','https://not5ch.net/x/','not5ch.net/x/')
B('サブドメインなしの 5ch.net','https://5ch.net/x/','5ch.io/x/')
B('2 段のサブドメインは to5chIo と同じく変えない','https://a.b.5ch.net/x/','a.b.5ch.net/x/')
B('既定のポートを外す','https://example.com:443/x/','example.com/x/')
B('http の既定のポートを外す','http://example.com:80/x/','example.com/x/')
B('ほかのポートは残す','http://example.com:8080/x/','example.com:8080/x/')
B('クエリとフラグメントを外す','https://example.com/x/?a=1#b','example.com/x/')
B('重なった / を 1 つにする','https://example.com//x//','example.com/x/')
B('道がない','https://example.com','example.com/')
B('前後の空白','  https://example.com/x/\n','example.com/x/')
B('末尾の点','https://example.com./x/','example.com/x/')
B('利用者名を外す','https://user:pw@example.com/x/','example.com/x/')
B('IPv6','http://[::1]:8080/x/','[::1]:8080/x/')
B('スキームなしは拒否','eagle.5ch.io/x/',None)
B('javascript: は拒否','javascript:alert(1)',None)
B('ftp は拒否','ftp://example.com/x/',None)
B('ホストがない','https:///x/',None)
B('途中の空白は拒否','https://example.com/a b/',None)
B('長すぎる','https://example.com/'+'a'*2048,None)
def RI(n,exp,kind,board,thread=None,detail=None):
    i=dict(fn='record_input',kind=kind,board=board)
    if thread is not None: i['thread']=thread
    if detail is not None: i['detail']=detail
    ids.append(C(n,i,exp))
RI('スレのレコード','favorite:eagle.5ch.io/x/:1700000000','favorite','https://eagle.5ch.net/x',thread='1700000000')
RI('板のレコードはスレが空','favorite:eagle.5ch.io/x/:','favorite','https://eagle.5ch.io/x/')
RI('細目','read_dev:eagle.5ch.io/x/:170:d0','read_dev','https://eagle.5ch.io/x/',thread='170',detail='d0')
RI('板のないレコード','setting:::font','setting',None,detail='font')
RI('区切りを含むスレと細目は混ざらない','k:a.example/b/:p%3Aq:r','k','https://a.example/b/',thread='p:q',detail='r')
RI('上と別のレコードになる','k:a.example/b/:p:q%3Ar','k','https://a.example/b/',thread='p',detail='q:r')
RI('% も逃がす','image:::https%3A//x.example/a%2525','image',None,detail='https://x.example/a%25')
RI('ポートの : も逃がす','k:h.example%3A8080/b/:','k','http://h.example:8080/b/')
RI('板が掲示板の URL でなければ拒否',dict(error='bad_id'),'favorite','javascript:alert(1)')
RI('種類の形が違えば拒否',dict(error='bad_id'),'Fav:x','https://a.example/b/')
ids.append(C('レコード ID は HMAC-SHA256 の 16 進',dict(fn='record_id',k_id=hx(keys['k_id']),kind='favorite',board='http://EAGLE.5ch.net/x',thread='1700000000'),rid))

h=lambda w,c,d:f'{w:012x}.{c:04x}.{d}'
DAY=86400000
Z='000000000000.0000.'
sch=[]
def S(n,p,e): sch.append(C(n,p,e))
env=lambda kind,body,**k:dict(kind=kind,hlc=h(1,0,'d0'),device_id='d0',body=body,**k)
BU='https://a.example/b/'
S('お気に入り',env('favorite',dict(board_url=BU,thread='1',title='t')),True)
S('知らないフィールドを通す',dict(env('favorite',dict(board_url=BU,x=[1,{'y':'z'}])),future=1),True)
S('知らない種類は決まりの外なので持ち続ける',env('new_kind',dict(a=1)),True)
S('tombstone は本体がなくてよい',dict(kind='favorite',hlc=h(1,0,'d0'),device_id='d0',deleted=True),True)
S('本体がなければ拒否',dict(kind='favorite',hlc=h(1,0,'d0'),device_id='d0'),False)
S('javascript: の URL を拒否',env('favorite',dict(board_url='javascript:alert(1)')),False)
S('URL の改行を拒否',env('favorite',dict(board_url='https://a/\nb')),False)
S('長すぎる URL を拒否',env('favorite',dict(board_url='https://a/'+'x'*2048)),False)
S('長さの上限ちょうどのスレタイ',env('favorite',dict(board_url=BU,title='あ'*1024)),True)
S('長すぎるスレタイを拒否',env('favorite',dict(board_url=BU,title='あ'*1025)),False)
S('文字列でないスレタイを拒否',env('favorite',dict(board_url=BU,title=1)),False)
S('kind がない',dict(hlc=h(1,0,'d0'),device_id='d0',body={}),False)
S('kind の形が違う',env('Fav!',{}),False)
S('HLC の形が違う',dict(env('favorite',dict(board_url=BU)),hlc='1'),False)
S('HLC の端末と device_id が違う',dict(env('favorite',dict(board_url=BU)),device_id='d1'),False)
S('device_id の形が違う',dict(kind='favorite',hlc='000000000001.0000.d|0',device_id='d|0',body=dict(board_url=BU)),False)
S('deleted が真偽値でない',dict(env('favorite',dict(board_url=BU)),deleted='yes'),False)
S('body がオブジェクトでない',dict(env('favorite',{}),body=[]),False)
S('知らないフィールドでも小数は拒否',dict(env('favorite',dict(board_url=BU)),x=1.5),False)
S('知らないフィールドでも安全でない整数は拒否',dict(env('favorite',dict(board_url=BU)),x=9007199254740992),False)
S('リセット',env('read_reset',dict(id='r1',target_res=0)),True)
S('リセット: id がない',env('read_reset',dict(target_res=0)),False)
S('リセット: 負の位置',env('read_reset',dict(id='r',target_res=-1)),False)
S('端末の記録',env('read_dev',dict(base_reset_id=None,pos=3,steps=[dict(at=h(1,0,'d0'),pos=3)])),True)
S('端末の記録: steps の HLC が違う',env('read_dev',dict(base_reset_id=None,pos=3,steps=[dict(at='x',pos=3)])),False)
S('端末の記録: steps が多すぎる',env('read_dev',dict(base_reset_id=None,pos=3,steps=[dict(at=h(1,0,'d0'),pos=3)]*65)),False)
S('順序キー',env('order',dict(key='5')),True)
S('順序キー: 末尾の 0 を拒否',env('order',dict(key='50')),False)
S('順序キー: 数字以外を拒否',env('order',dict(key='a')),False)
S('最終閲覧',env('last_view',dict(board_url=BU,last_viewed_at=5)),True)
S('最終閲覧: 時刻が文字列',env('last_view',dict(board_url=BU,last_viewed_at='5')),False)
S('設定: 値は単純な値だけ',env('setting',dict(key='a',value=dict(x=1))),False)
S('設定: 真偽値',env('setting',dict(key='a',value=True)),True)
S('NG: 長すぎる',env('ng',dict(type='word',value='x'*4097)),False)
S('権限系',env('secret',dict(url=BU,value='k')),True)

mg=[]
def M(n,i,e): mg.append(C(n,i,e))
P=lambda w,c,d,body=None,**k:dict(kind='favorite',hlc=h(w,c,d),device_id=d,**({'body':body} if body is not None else {}),**k)
a=P(2,0,'a',dict(title='new')); b=P(1,0,'b',dict(title='old'))
M('LWW: HLC の新しい方',dict(fn='lww',a=a,b=b),a)
a=P(1,1,'a',dict(title='x')); b=P(1,0,'b',dict(title='y'))
M('LWW: 壁時計が同じならカウンター',dict(fn='lww',a=a,b=b),a)
a=P(1,0,'a',dict(title='x')); b=P(1,0,'b',dict(title='y'))
M('LWW: 同じ HLC は device_id の辞書順で後の方',dict(fn='lww',a=a,b=b),b)
a=P(1,0,'a',dict(title='x')); b=P(1,0,'a',dict(title='y'))
M('LWW: HLC も端末も同じなら中身の順(端末を戻した場合)',dict(fn='lww',a=a,b=b),b)
a=P(2,0,'a',deleted=True); b=P(1,0,'b',dict(title='y'))
M('tombstone が新しければ消える',dict(fn='lww',a=a,b=b),a)
a=P(1,0,'a',deleted=True); b=P(2,0,'b',dict(title='y'))
M('追加が新しければ戻る',dict(fn='lww',a=a,b=b),b)
a=P(1,0,'a',deleted=True); b=P(1,0,'b',dict(title='y'))
M('追加と削除が同じ時刻でも一方に決まる',dict(fn='lww',a=a,b=b),b)
a=dict(P(2,0,'a',dict(title='x',new_body=1)),new_top=[1,'a']); b=P(1,0,'b',dict(title='y'))
M('知らないフィールドは勝った方に残る',dict(fn='lww',a=a,b=b),a)
ex=dict(P(1,0,'a',dict(title='x',new_body=1)),new_top=2)
M('更新で知らないフィールドを残す',dict(fn='update',existing=ex,kind='favorite',changes=dict(title='y'),stamp=h(2,0,'b'),device='b'),dict(kind='favorite',hlc=h(2,0,'b'),device_id='b',new_top=2,body=dict(title='y',new_body=1)))
M('消した項目を更新すると戻る',dict(fn='update',existing=P(1,0,'a',deleted=True),kind='favorite',changes=dict(title='y'),stamp=h(2,0,'b'),device='b'),dict(kind='favorite',hlc=h(2,0,'b'),device_id='b',body=dict(title='y')))
M('新しいレコード',dict(fn='update',existing=None,kind='favorite',changes=dict(title='y'),stamp=h(2,0,'b'),device='b'),dict(kind='favorite',hlc=h(2,0,'b'),device_id='b',body=dict(title='y')))
M('tombstone は本体を残さない',dict(fn='tombstone',existing=ex,stamp=h(2,0,'b'),device='b'),dict(kind='favorite',hlc=h(2,0,'b'),device_id='b',deleted=True,new_top=2))
L=lambda w,c,d,v=None,deleted=False,**body:dict(kind='last_view',hlc=h(w,c,d),device_id=d,**({'deleted':True} if deleted else {}),**(dict(body=dict(body,**({'last_viewed_at':v} if v is not None else {}))) if (v is not None or body) else {}))
M('tombstone でも max のフィールドは残せる',dict(fn='tombstone',existing=L(1,0,'a',9,title='t'),stamp=h(2,0,'b'),device='b',keep=['last_viewed_at']),dict(kind='last_view',hlc=h(2,0,'b'),device_id='b',deleted=True,body=dict(last_viewed_at=9)))
M('最終閲覧: HLC が古くても max',dict(fn='max',a=L(1,0,'a',9,title='old'),b=L(2,0,'b',5,title='new')),L(2,0,'b',9,title='new'))
M('最終閲覧: 同じ時刻',dict(fn='max',a=L(1,0,'a',5),b=L(1,0,'b',5)),L(1,0,'b',5))
M('最終閲覧: tombstone をまたいでも max',dict(fn='max',a=L(2,0,'a',5,deleted=True),b=L(1,0,'b',9,title='t')),L(2,0,'a',9,deleted=True))
M('最終閲覧: 片方に時刻がない',dict(fn='max',a=L(2,0,'a',deleted=True),b=L(1,0,'b',9,title='t')),L(2,0,'a',9,deleted=True))
M('順序キー: 両端なし',dict(fn='order_between',a=None,b=None),'5')
for x,y,e in [('5',None,'6'),('9',None,'91'),('99',None,'991'),('89',None,'9'),(None,'5','3'),(None,'1','05'),(None,'01','005'),('1','2','15'),('1','3','2'),('15','16','155'),('19','2','195'),('1','11','105'),('05','1','08'),('1','101','1005')]:
    M(f'順序キー: {x} と {y} の間',dict(fn='order_between',a=x,b=y),e)
M('順序キー: 逆の順は拒否',dict(fn='order_between',a='5',b='3'),dict(error='bad_order_key'))
M('順序キー: 同じ値は拒否',dict(fn='order_between',a='5',b='5'),dict(error='bad_order_key'))
M('順序キー: 末尾の 0 は拒否',dict(fn='order_between',a='50',b=None),dict(error='bad_order_key'))
M('順序キー: 同じ値は ID で並べる',dict(fn='order_sort',items=[dict(key='5',id='b'),dict(key='12',id='z'),dict(key='5',id='a'),dict(key='6',id='a')]),['z','a','b','a'])
now=0x19a00000000
M('HLC: 形',dict(fn='hlc_format',wall=1000,counter=2,device='d0'),'0000000003e8.0002.d0')
M('HLC: 読む',dict(fn='hlc_parse',text='0000000003e8.0002.d0'),dict(wall=1000,counter=2,device='d0'))
for t in ['','1.2.a','0000000003E8.0002.d0','0000000003e8.0002.d|0','0000000003e8.0002.']:
    M(f'HLC: {t!r} は拒否',dict(fn='hlc_parse',text=t),dict(error='bad_hlc'))
M('HLC: 壁時計で比べる',dict(fn='hlc_compare',a=h(2,0,'a'),b=h(1,9,'z')),1)
M('HLC: カウンターで比べる',dict(fn='hlc_compare',a=h(1,0,'z'),b=h(1,1,'a')),-1)
M('HLC: 同じ値は device_id の辞書順',dict(fn='hlc_compare',a=h(1,1,'a'),b=h(1,1,'b')),-1)
M('HLC: 初めての更新',dict(fn='hlc_stamp',clock=Z,now=1000,device='a'),dict(stamp=h(1000,0,'a'),clock=h(1000,0,'a')))
M('HLC: 同じ時刻ならカウンターを進める',dict(fn='hlc_stamp',clock=h(1000,0,'a'),now=1000,device='a'),dict(stamp=h(1000,1,'a'),clock=h(1000,1,'a')))
M('HLC: 時計が戻っても進める',dict(fn='hlc_stamp',clock=h(2000,3,'a'),now=1000,device='a'),dict(stamp=h(2000,4,'a'),clock=h(2000,4,'a')))
M('HLC: カウンターが尽きたら壁時計を進める',dict(fn='hlc_stamp',clock=h(1000,0xffff,'a'),now=1000,device='a'),dict(stamp=h(1001,0,'a'),clock=h(1001,0,'a')))
M('HLC: 受け取った HLC より大きくなる',dict(fn='hlc_stamp',clock=h(5000,7,'z'),now=1000,device='a'),dict(stamp=h(5000,8,'a'),clock=h(5000,8,'a')))
M('HLC: レコードの HLC より必ず大きくする',dict(fn='hlc_stamp',clock=h(1000,0,'a'),now=1000,device='a',floor=h(1500,2,'b')),dict(stamp=h(1500,3,'a'),clock=h(1500,3,'a')))
M('HLC: レコードより新しければそのまま',dict(fn='hlc_stamp',clock=h(1000,0,'a'),now=2000,device='a',floor=h(1500,2,'b')),dict(stamp=h(2000,0,'a'),clock=h(2000,0,'a')))
M('HLC: 同じ値でも端末の順で大きければそのまま',dict(fn='hlc_stamp',clock=Z,now=1000,device='b',floor=h(1000,0,'a')),dict(stamp=h(1000,0,'b'),clock=h(1000,0,'b')))
M('HLC: 同じ値で端末の順が小さければ進める',dict(fn='hlc_stamp',clock=Z,now=1000,device='a',floor=h(1000,0,'b')),dict(stamp=h(1000,1,'a'),clock=h(1000,1,'a')))
far=now+3*DAY
M('HLC: 24 時間以上先のレコードは上書きできるが、端末の HLC は進まない',dict(fn='hlc_stamp',clock=h(now,0,'a'),now=now,device='a',floor=h(far,5,'b')),dict(stamp=h(far,6,'a'),clock=h(now,1,'a')))
M('HLC: 受信で進む',dict(fn='hlc_observe',clock=h(now,0,'a'),remote=h(now+5,1,'b'),now=now),h(now+5,1,'b'))
M('HLC: 古い受信では戻らない',dict(fn='hlc_observe',clock=h(now,0,'a'),remote=h(now-5,1,'b'),now=now),h(now,0,'a'))
M('HLC: 24 時間ちょうど先は進めない',dict(fn='hlc_observe',clock=h(now,0,'a'),remote=h(now+DAY,0,'b'),now=now),h(now,0,'a'))
M('HLC: 24 時間より 1ms 手前は進める',dict(fn='hlc_observe',clock=h(now,0,'a'),remote=h(now+DAY-1,0,'b'),now=now),h(now+DAY-1,0,'b'))
st=lambda w,p,d='a':dict(at=h(w,0,d),pos=p)
M('steps: 足す',dict(fn='push_step',steps=[],at=h(1,0,'a'),pos=5),[st(1,5)])
M('steps: 前の小さい要素を消す',dict(fn='push_step',steps=[st(1,500),st(2,100)],at=h(3,0,'a'),pos=300),[st(1,500),st(3,300)])
M('steps: 同じ位置は前を消す',dict(fn='push_step',steps=[st(1,100)],at=h(2,0,'a'),pos=100),[st(2,100)])
M('steps: 小さくなる読みは残す',dict(fn='push_step',steps=[st(1,500)],at=h(2,0,'a'),pos=100),[st(1,500),st(2,100)])
M('steps: 最新の 8 件まで',dict(fn='push_step',steps=[st(i,100-i) for i in range(1,9)],at=h(9,0,'a'),pos=1),[st(i,100-i) for i in range(2,9)]+[st(9,1)])
RS=lambda w,c,d,i,t=0:dict(kind='read_reset',hlc=h(w,c,d),device_id=d,body=dict(id=i,target_res=t))
DV=lambda d,base,pos,steps,w=9:dict(kind='read_dev',hlc=h(w,0,d),device_id=d,body=dict(base_reset_id=base,pos=pos,steps=steps))
M('既読位置: リセットなしは pos の最大',dict(fn='read_position',reset=None,devs=[DV('a',None,500,[]),DV('b',None,300,[])]),500)
M('既読位置: 何もない',dict(fn='read_position',reset=None,devs=[]),0)
M('既読位置: 違うリセットの端末はリセットより後の steps だけ',dict(fn='read_position',reset=RS(5,0,'b','r'),devs=[DV('a',None,900,[st(4,900),st(6,350),st(7,100)])]),350)
M('既読位置: リセットと同じ HLC の読みは数えない',dict(fn='read_position',reset=RS(5,0,'a','r'),devs=[DV('a',None,900,[st(5,900)])]),0)
M('既読位置: target_res が下限',dict(fn='read_position',reset=RS(5,0,'b','r',100),devs=[DV('a','r',50,[])]),100)
M('既読位置: 同じリセットの端末は pos',dict(fn='read_position',reset=RS(5,0,'b','r'),devs=[DV('a','r',70,[])]),70)
M('読む: 同じリセットなら pos は増えるだけ',dict(fn='record_read',dev=DV('a','r',70,[st(6,70)]),reset=RS(5,0,'b','r'),pos=30,stamp=h(7,0,'a'),device='a'),dict(kind='read_dev',hlc=h(7,0,'a'),device_id='a',body=dict(base_reset_id='r',pos=70,steps=[st(6,70),st(7,30)])))
M('読む: 新しいリセットを知ると、それより後の読みだけ引き継ぐ',dict(fn='record_read',dev=DV('a',None,900,[st(4,900),st(6,350)]),reset=RS(5,0,'b','r'),pos=100,stamp=h(7,0,'a'),device='a'),dict(kind='read_dev',hlc=h(7,0,'a'),device_id='a',body=dict(base_reset_id='r',pos=350,steps=[st(6,350),st(7,100)])))
M('読む: 知らないフィールドを残す',dict(fn='record_read',dev=dict(DV('a',None,1,[]),future=1),reset=None,pos=2,stamp=h(7,0,'a'),device='a'),dict(kind='read_dev',hlc=h(7,0,'a'),device_id='a',future=1,body=dict(base_reset_id=None,pos=2,steps=[st(7,2)])))
M('リセットの floor は知っている読みの最大',dict(fn='reset_floor',reset=RS(2,0,'b','r'),devs=[DV('a','r',1,[st(8,1)],w=8),DV('c','r',1,[st(3,1,'c')],w=3)]),h(8,0,'a'))
M('リセットの floor: 何もない',dict(fn='reset_floor',reset=None,devs=[]),Z)
SC=lambda n,ev,e:M('既読のシナリオ: '+n,dict(fn='read_script',events=ev),e)
SC('PC で 500、スマホで 300 まで読んだ',[dict(dev='pc',t=1000,read=500),dict(dev='phone',t=2000,read=300),dict(sync_all=3000)],dict(pc=500,phone=500))
SC('PC で 500 まで読んだ後、スマホで未読に戻した',[dict(dev='pc',t=1000,read=500),dict(sync=['pc','phone'],t=1500),dict(dev='phone',t=2000,reset=0,id='r1'),dict(sync_all=3000)],dict(pc=0,phone=0))
SC('スマホで未読に戻した後、知らないオフラインの PC で 350 まで読み、次に開いて 100 まで読んだ',[dict(dev='phone',t=1000,reset=0,id='r1'),dict(dev='pc',t=2000,read=350),dict(dev='pc',t=3000,read=100),dict(sync_all=4000)],dict(pc=350,phone=350))
SC('PC で 500 まで読み、スマホで未読に戻した後、PC が同期した',[dict(dev='pc',t=1000,read=500),dict(sync=['pc','phone'],t=1500),dict(dev='phone',t=2000,reset=0,id='r1'),dict(expect=dict(pc=500,phone=0)),dict(sync=['phone','pc'],t=3000),dict(expect=dict(pc=0,phone=0)),dict(sync_all=4000)],dict(pc=0,phone=0))
SC('2 台で同時に別の位置へ未読に戻した',[dict(dev='pc',t=1000,reset=100,id='a'),dict(dev='phone',t=2000,reset=200,id='b'),dict(sync_all=3000)],dict(pc=200,phone=200))
SC('2 台で同じ時刻に未読に戻した',[dict(dev='pc',t=1000,reset=100,id='a'),dict(dev='phone',t=1000,reset=200,id='b'),dict(sync_all=3000)],dict(pc=200,phone=200))
SC('同期してから読み直しても既読位置が下がらない',[dict(dev='phone',t=1000,reset=0,id='r1'),dict(dev='pc',t=2000,read=350),dict(sync_all=2500),dict(expect=dict(pc=350)),dict(dev='pc',t=3000,read=100),dict(expect=dict(pc=350)),dict(sync_all=4000)],dict(pc=350,phone=350))
SC('新しいリセットを知った読みも、まだ知らない別のリセットより後なら数える',[dict(dev='a',t=1000,reset=0,id='r1'),dict(sync=['a','c'],t=1500),dict(dev='b',t=2000,reset=0,id='r2'),dict(dev='c',t=3000,read=350),dict(sync_all=4000)],dict(a=350,b=350,c=350))
SC('時計が 3 日先の端末の読みも、見たあとなら未読に戻せる',[dict(dev='pc',t=1000000000+3*DAY,read=500),dict(dev='phone',t=1000000000,read=10),dict(sync=['pc','phone'],t=1000000100),dict(expect=dict(phone=500)),dict(dev='phone',t=1000000200,reset=0,id='r1'),dict(expect=dict(phone=0)),dict(sync_all=1000000300)],dict(pc=0,phone=0))
SC('時計が 3 日先の端末が書いたリセットも、次のリセットで上書きできる',[dict(dev='pc',t=1000000000+3*DAY,reset=50,id='r1'),dict(sync=['pc','phone'],t=1000000100),dict(dev='phone',t=1000000200,reset=7,id='r2'),dict(sync_all=1000000300)],dict(pc=7,phone=7))
SC('未読に戻してから読む',[dict(dev='pc',t=1000,read=500),dict(sync_all=1500),dict(dev='phone',t=2000,reset=100,id='r1'),dict(sync_all=2500),dict(dev='pc',t=3000,read=50),dict(expect=dict(pc=100)),dict(dev='pc',t=4000,read=150),dict(sync_all=5000)],dict(pc=150,phone=150))
SC('自分で未読に戻してから読む',[dict(dev='pc',t=1000,read=500),dict(dev='pc',t=2000,reset=0,id='r1'),dict(expect=dict(pc=0)),dict(dev='pc',t=3000,read=20),dict(expect=dict(pc=20))],dict(pc=20))
dec=lambda poss,start=2000:[dict(dev='pc',t=start+i*100,read=p) for i,p in enumerate(poss)]
SC('steps: 小さくなる読みが 8 回なら最初の位置が残る',[dict(dev='phone',t=1000,reset=0,id='r1')]+dec([900,800,700,600,500,400,300,200])+[dict(sync_all=9000)],dict(pc=900,phone=900))
SC('steps: 9 回を超えると、知らないリセットの後の最初の読みが数えられなくなる(下に外れるだけで一致はする)',[dict(dev='phone',t=1000,reset=0,id='r1')]+dec([900,800,700,600,500,400,300,200,100,50])+[dict(sync_all=9000)],dict(pc=700,phone=700))
SC('steps: 溢れても、リセットを知ったあとの pos は保たれる',[dict(dev='phone',t=1000,reset=0,id='r1'),dict(sync=['phone','pc'],t=1500)]+dec([900,800,700,600,500,400,300,200,100,50])+[dict(sync_all=9000)],dict(pc=900,phone=900))
SC('steps: 増えるだけの読みは 1 件で済む',[dict(dev='phone',t=1000,reset=0,id='r1')]+dec([10*i for i in range(1,31)])+[dict(sync_all=9000)],dict(pc=300,phone=300))
PD=200*DAY
F=lambda w,c,d,title='x',**k:P(w,c,d,dict(title=title),**k)
RB=lambda n,local,pending,full,exp,now=PD:M('リベース: '+n,dict(fn='rebase',local=local,pending=pending,full=full,now=now),dict(dict(records={},pending={},removed=[],dropped_pending=[],needs_confirmation=False),**exp))
LR=lambda p,v:dict(payload=p,version=v)
old=F(PD-100*DAY,0,'a'); rec1=F(PD-DAY,0,'a'); newer=F(PD-DAY,1,'b','server')
RB('同期済みで全件にないものは消す',dict(x=LR(rec1,5),y=LR(rec1,6)),{},dict(y=LR(rec1,9)),dict(records=dict(y=LR(rec1,9)),removed=['x']))
RB('全件にあるものはサーバーの値に合わせる',dict(x=LR(rec1,5)),{},dict(x=LR(newer,9)),dict(records=dict(x=LR(newer,9))))
RB('手元の方が新しければ送り直す(サーバーが古い値に戻った場合)',dict(x=LR(newer,9)),{},dict(x=LR(rec1,5)),dict(records=dict(x=LR(newer,5)),pending=dict(x=dict(payload=newer,base_version=5))))
RB('一度も同期していないものは消さない(クォータで外した手元の履歴)',dict(x=LR(rec1,0)),{},dict(y=LR(rec1,1)),dict(records=dict(x=LR(rec1,0),y=LR(rec1,1))))
RB('新しい未送信は残す: 全件にないレコード',dict(x=LR(rec1,5)),dict(x=rec1),dict(y=LR(rec1,1)),dict(records=dict(x=LR(rec1,0),y=LR(rec1,1)),pending=dict(x=dict(payload=rec1,base_version=0))))
RB('新しい未送信は残す: 手元にまだないレコード',{},dict(x=rec1),dict(y=LR(rec1,1)),dict(records=dict(x=LR(rec1,0),y=LR(rec1,1)),pending=dict(x=dict(payload=rec1,base_version=0))))
RB('新しい未送信が全件に勝てば送る',dict(x=LR(newer,5)),dict(x=newer),dict(x=LR(rec1,9)),dict(records=dict(x=LR(newer,9)),pending=dict(x=dict(payload=newer,base_version=9))))
RB('未送信が全件に負ければ送らない',dict(x=LR(rec1,5)),dict(x=rec1),dict(x=LR(newer,9)),dict(records=dict(x=LR(newer,9))))
RB('90 日より古い未送信は捨て、全件の値に戻す',dict(x=LR(old,5)),dict(x=old),dict(x=LR(F(PD-101*DAY,0,'b'),9)),dict(records=dict(x=LR(F(PD-101*DAY,0,'b'),9)),dropped_pending=['x']))
RB('90 日より古い未送信は捨て、全件になければ消す(削除済みが戻らない)',dict(x=LR(old,5),y=LR(rec1,6)),dict(x=old),dict(y=LR(rec1,6)),dict(records=dict(y=LR(rec1,6)),removed=['x'],dropped_pending=['x']))
RB('90 日より古い未送信は、同期したことがなくても捨てる',dict(x=LR(old,0)),dict(x=old),dict(y=LR(rec1,1)),dict(records=dict(y=LR(rec1,1)),removed=['x'],dropped_pending=['x']))
exact=F(PD-90*DAY,0,'a')
RB('ちょうど 90 日の未送信は残す',{},dict(x=exact),dict(y=LR(rec1,1)),dict(records=dict(x=LR(exact,0),y=LR(rec1,1)),pending=dict(x=dict(payload=exact,base_version=0))))
tomb=P(PD-DAY,0,'b',deleted=True)
RB('全件の tombstone で手元も消える',dict(x=LR(rec1,5)),{},dict(x=LR(tomb,9)),dict(records=dict(x=LR(F(PD-DAY,0,'b') if False else tomb,9))))
RB('全件が空なら確認を求める',dict(x=LR(rec1,5)),{},{},dict(removed=['x'],needs_confirmation=True))
many={f'k{i:02d}':LR(rec1,5) for i in range(12)}
RB('大量に消えるなら確認を求める',many,{},{f'k{i:02d}':LR(rec1,5) for i in range(2)},dict(records={f'k{i:02d}':LR(rec1,5) for i in range(2)},removed=[f'k{i:02d}' for i in range(2,12)],needs_confirmation=True))
many2={f'k{i:03d}':LR(rec1,5) for i in range(100)}
RB('少しだけ消えるなら確認なし',many2,{},{f'k{i:03d}':LR(rec1,5) for i in range(91)},dict(records={f'k{i:03d}':LR(rec1,5) for i in range(91)},removed=[f'k{i:03d}' for i in range(91,100)]))
RB('消える割合が低ければ確認なし',{f'k{i:03d}':LR(rec1,5) for i in range(100)},{},{f'k{i:03d}':LR(rec1,5) for i in range(85)},dict(records={f'k{i:03d}':LR(rec1,5) for i in range(85)},removed=[f'k{i:03d}' for i in range(85,100)]))
lvl=L(PD-DAY,0,'a',9,title='t'); lvs=L(PD-DAY,1,'b',5,title='s')
RB('最終閲覧の max はリベースでも効く',dict(x=LR(lvl,5)),{},dict(x=LR(lvs,9)),dict(records=dict(x=LR(L(PD-DAY,1,'b',9,title='s'),9)),pending=dict(x=dict(payload=L(PD-DAY,1,'b',9,title='s'),base_version=9))))
# シードごとの最終状態のハッシュ。TS の実装で求め、Kotlin と比べる
hs=json.load(open(sys.argv[2])) if len(sys.argv)>2 else {}
SIMS=[dict(seed=s,devices=3,ops=200,skews=[0,3600000,-7200000,3*DAY]) for s in (1,2,3,4)]+[dict(seed=s,devices=4,ops=2000,skews=[0,3600000,-7200000,3*DAY]) for s in (5,6)]+[dict(seed=s,devices=2,ops=100,skews=[0],max_reads=8) for s in (7,8)]+[dict(seed=s,devices=3,ops=1000,skews=[0,3600000],decreasing_reads=True) for s in (9,10)]
for s in SIMS:
    M(f"同じシードで PC とスマホが同じ状態になる: {s['seed']}",dict(fn='sim',**s),hs.get(str(s['seed']),'TODO'))
def dump(name,cases):
    with open(OUT+name,'w',encoding='utf8') as f:
        f.write('[\n'+',\n'.join('  '+json.dumps(c,ensure_ascii=False,separators=(', ',': ')) for c in cases)+'\n]\n')
dump('sync-crypto.json',cry);dump('sync-id.json',ids);dump('sync-schema.json',sch);dump('sync-merge.json',mg)
print(len(cry),len(ids),len(sch),len(mg))
