// Supabase の Project URL と publishable(anon) key（英単語サイトと同じもの）。
// ※ service_role キーは絶対にここへ入れない。
// sites：ポータルに並べるサイト。id は portal_sites.site と同じ名前。url が空なら「開く」は出さない。
window.PORTAL_CONFIG={
  url:'https://ljowllihyetgvuugafam.supabase.co',
  key:'sb_publishable_lfvqV1MdT5eioPyLOnM36Q_a1EZGSV0',
  brand:'テンシ ポータル',
  sites:[
    {id:'eitango',label:'テンシで英単語',short:'英単語',url:'https://suiran-angel.pages.dev/'},
    {id:'kobunbunpou',label:'Dr.Yの古典文法',short:'古典文法',url:'https://lightblueearphone.github.io/Kobunbunpou/'}
  ]
};
