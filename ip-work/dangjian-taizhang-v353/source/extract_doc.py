#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抽取 .docx / .doc 的文本与表格，用于软著材料审阅（只读，不改动源文件）"""
import sys, os, zipfile, re

def docx_text(path):
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(path)
    out = []
    body = doc.element.body
    # 按文档顺序遍历段落与表格
    import docx
    for child in body.iterchildren():
        tag = child.tag.split('}')[-1]
        if tag == 'p':
            p = Paragraph(child, doc)
            t = p.text.strip()
            if t:
                out.append(t)
        elif tag == 'tbl':
            tbl = Table(child, doc)
            out.append('[表格开始]')
            for row in tbl.rows:
                cells = []
                seen = set()
                for c in row.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    cells.append(c.text.replace('\n', ' ').strip())
                out.append(' | '.join(cells))
            out.append('[表格结束]')
    return '\n'.join(out)

def doc_text(path):
    """对 .doc（OLE CFB）做尽力而为的文本抽取：读取 WordDocument 流并清理控制码。
    注意：这是启发式抽取，可能丢失格式/表格结构，需在台账中标注。"""
    import olefile
    out = []
    ole = olefile.OleFileIO(path)
    for stream in ole.listdir():
        name = '/'.join(stream)
        if name in ('WordDocument',):
            data = ole.openstream(stream).read()
            # 中文 Word 常见为 UTF-16LE 存储；尝试多种解码
            for enc in ('utf-16-le', 'gbk', 'cp936'):
                try:
                    txt = data.decode(enc, errors='ignore')
                except Exception:
                    continue
                # 保留中文、ASCII 可打印、常见标点，剔除控制码
                txt = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', txt)
                # 仅保留含中文或较长可读片段
                chinese = len(re.findall(r'[\u4e00-\u9fff]', txt))
                if chinese > 30:
                    out.append(f'=== stream={name} decode={enc} 中文字符={chinese} ===')
                    out.append(txt)
                    break
    ole.close()
    return '\n'.join(out)

if __name__ == '__main__':
    src = sys.argv[1]
    ext = os.path.splitext(src)[1].lower()
    try:
        text = docx_text(src) if ext == '.docx' else doc_text(src)
    except Exception as e:
        print(f'EXTRACT_ERROR: {type(e).__name__}: {e}')
        sys.exit(1)
    sys.stdout.write(text)