const http=require('http');
const data=JSON.stringify({message:"Summarize Shankar's role at SANA Software (BEL)",history:[],sessionId:'test-script'});
const opts={hostname:'localhost',port:3000,path:'/api/chat',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}};
const req=http.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{console.log('STATUS',res.statusCode);console.log('BODY',d)})});
req.on('error',e=>console.error('REQERR',e));
req.write(data);req.end();
