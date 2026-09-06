import { ZipFile } from 'yazl';
export async function zipFiles(entries:{name:string;content:string|Buffer;mode?:number}[]) {
  const zip=new ZipFile();
  for(const entry of entries)zip.addBuffer(Buffer.isBuffer(entry.content)?entry.content:Buffer.from(entry.content),entry.name,{mode:entry.mode});
  zip.end();const chunks:Buffer[]=[];for await(const c of zip.outputStream)chunks.push(c);return Buffer.concat(chunks);
}
export const epubEntries=[
  {name:'mimetype',content:'application/epub+zip'},
  {name:'META-INF/container.xml',content:'<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'},
  {name:'OEBPS/book.opf',content:'<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'},
  {name:'OEBPS/a.xhtml',content:'<html><body><h1>第二章 钟楼</h1><p>陆砚走进钟楼。&amp; 留下记号。</p></body></html>'},
  {name:'OEBPS/b.xhtml',content:'<html><head><title>不应成为正文</title></head><body><h1>第一章 旧地图</h1><p>陆砚展开旧地图。</p><script>throw Error("injection")</script><style>body{display:none}</style></body></html>'},
];
