import { describe,it,expect } from 'vitest';
import { parseImport,decodeText,UPLOAD_LIMIT } from '../../apps/server/src/reference/import.js';
import { zipFiles,epubEntries } from '../fixtures/epub.js';
describe('参考文件完整性与边界',()=>{
  it('EPUB按spine而非文件顺序读取，剔除脚本样式，实体解码且切分完整',async()=>{
    const buffer=await zipFiles(epubEntries),result=await parseImport(buffer,'sample.epub','UTF8');
    expect(result.text.indexOf('第一章')).toBeLessThan(result.text.indexOf('第二章'));
    expect(result.text).not.toMatch(/injection|display:none|不应成为正文/);
    expect(result.text).toContain('& 留下记号');
    expect(result.chapters.map(c=>c.title)).toEqual(['第一章 旧地图','第二章 钟楼']);
    expect(result.chapters.at(-1)!.end).toBe([...result.text].length);
  });
  it('严格编码拒绝乱码，GB18030需显式选择',()=>{
    const bytes=Buffer.from([0xc2,0xbd,0xd1,0xe2]);
    expect(()=>decodeText(bytes,'UTF8')).toThrow();expect(decodeText(bytes,'GB18030')).toBe('陆砚');
    expect(decodeText(Buffer.from('\uFEFF第一章\r\n😀'),'UTF8')).toBe('第一章\n😀');
  });
  it('拒绝路径越界、符号链接、加密描述及XML外部实体',async()=>{
    const valid=await zipFiles([{name:'safe/file.txt',content:'x'}]);
    const unsafe=Buffer.from(valid.toString('latin1').replaceAll('safe/file.txt','../x/file.txt'),'latin1');
    await expect(parseImport(unsafe,'bad.epub','UTF8')).rejects.toMatchObject({code:'INVALID_EPUB'});
    await expect(parseImport(await zipFiles([{name:'link',content:'outside',mode:0o120777}]),'bad.epub','UTF8')).rejects.toMatchObject({code:'INVALID_EPUB'});
    await expect(parseImport(await zipFiles([...epubEntries,{name:'META-INF/encryption.xml',content:'<encryption/>'}]),'bad.epub','UTF8')).rejects.toMatchObject({code:'INVALID_EPUB'});
    const xml=epubEntries.map(e=>e.name==='META-INF/container.xml'?{...e,content:'<!DOCTYPE a [<!ENTITY b SYSTEM "file:///test">]><container/>'}:e);
    await expect(parseImport(await zipFiles(xml),'bad.epub','UTF8')).rejects.toMatchObject({code:'INVALID_EPUB'});
  });
  it('20MiB上传与单条目膨胀限制不会截断通过',async()=>{
    await expect(parseImport(Buffer.alloc(UPLOAD_LIMIT+1),'big.txt','UTF8')).rejects.toMatchObject({code:'IMPORT_LIMIT'});
    const bomb=await zipFiles([{name:'large.xhtml',content:Buffer.alloc(UPLOAD_LIMIT+1,65)}]);
    expect(bomb.length).toBeLessThan(UPLOAD_LIMIT);
    await expect(parseImport(bomb,'bomb.epub','UTF8')).rejects.toMatchObject({code:'IMPORT_LIMIT'});
  });
});
