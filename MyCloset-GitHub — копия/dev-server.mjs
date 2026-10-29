import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {extname,resolve,sep} from 'node:path';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ttf':'font/ttf'};

export function createDevServer(){
  return http.createServer(async(request,response)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{...headers,Allow:'GET, HEAD'});response.end();return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400,headers);response.end('Bad request');return;}
    if(pathname==='/')pathname='/index.html';
    const file=resolve(ROOT,'.'+pathname);
    const type=MIME[extname(file)];
    if(!file.startsWith(ROOT.endsWith(sep)?ROOT:ROOT+sep)||!type||pathname.split(/[\\/]/).some(part=>part.startsWith('.'))){response.writeHead(404,headers);response.end('Not found');return;}
    try{const content=await readFile(file);response.writeHead(200,{...headers,'Content-Type':type,'Content-Length':content.byteLength,...(pathname==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})});response.end(request.method==='HEAD'?undefined:content);}
    catch{response.writeHead(404,headers);response.end('Not found');}
  });
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const port=process.env.PORT===undefined?4173:Number(process.env.PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
  const server=createDevServer();
  server.on('error',error=>{console.error('Не удалось открыть локальный просмотр: '+error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('Локальный просмотр: http://127.0.0.1:'+port));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
