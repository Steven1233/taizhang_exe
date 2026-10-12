#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成软著申请用《源程序》文档（Word）

规则依据（来自用户提供的《计算机软件著作权登记申请表》填写注意事项）：
  - WORD 文档格式的代码，整套代码的【前 30 页】和【后 30 页】
  - 每页不低于 50 行
  - A4 纸

实现要点：
  - 源程序取自项目真实源码，按固定文件顺序拼接，不增删代码内容；
    仅在每个文件前插入一行注释形式的文件路径标记（便于溯源，已在证据台账中声明）
  - 对超宽行做“按显示宽度硬折行”预处理，使每页行数完全可控、不依赖 Word 自动换行
  - 每页固定 50 行，通过分页符精确切分，共 60 页
  - 页眉标注软件名称/版本与“前 30 页 / 后 30 页”，页脚标注页码
"""
import os
import sys
import unicodedata
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = '/workspace'
OUT = '/workspace/ip-work/dangjian-taizhang-v353/software-copyright/delivery/党建工作台账_源程序.docx'

SOFTWARE_NAME = '党建工作台账应用'
VERSION = 'V3.5.3'

# 每页固定行数
LINES_PER_PAGE = 50
PAGES_PER_PART = 30
# 单行最大显示宽度（半角字符数；全角按 2 计）
MAX_UNITS = 95
# 正文字号与行距（磅）
FONT_SIZE = 9
LINE_SPACING_PT = 14
# 页边距（厘米）——上下留足余量，保证“每页不低于 50 行”在任何行距下都不溢出
MARGIN_CM = 1.2

# 拼接顺序：入口 → 布局 → 页面 → 组件 → 数据层 → 类型 → 工具 → Electron 主进程
FILE_ORDER = [
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
    'package.json',
    'src/main.tsx',
    'src/App.tsx',
    'src/App.css',
    'src/vite-env.d.ts',
    'src/layouts/MainLayout.tsx',
    'src/pages/Dashboard.tsx',
    'src/pages/OrgChartPage.tsx',
    'src/pages/Members.tsx',
    'src/pages/Meetings.tsx',
    'src/pages/Talks.tsx',
    'src/pages/Logs.tsx',
    'src/pages/Settings.tsx',
    'src/components/ErrorBoundary.tsx',
    'src/components/MeetingForm.tsx',
    'src/components/MemberForm.tsx',
    'src/components/TalkForm.tsx',
    'src/components/OrgChart.tsx',
    'src/components/OrgChart.css',
    'src/db/index.ts',
    'src/types/index.ts',
    'src/utils/memberStatus.ts',
    'src/utils/orgChart.ts',
    'src/utils/chartSeries.ts',
    'src/utils/backup.ts',
    'src/utils/mergeData.ts',
    'src/utils/autoSync.ts',
    'src/utils/exportExcel.ts',
    'src/utils/exportTalkExcel.ts',
    'src/utils/exportWord.ts',
    'src/utils/importGroupExcel.ts',
    'src/utils/logHelper.ts',
    'electron/main.cjs',
    'electron/preload.cjs',
]


def disp_width(s: str) -> int:
    """显示宽度：东亚全角/宽字符按 2，其余按 1"""
    w = 0
    for ch in s:
        w += 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1
    return w


def hard_wrap(line: str, limit: int = MAX_UNITS):
    """按显示宽度硬折行（不丢字符），返回若干段落文本"""
    if line == '':
        return ['']
    out, cur, curw = [], '', 0
    for ch in line:
        cw = 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1
        if curw + cw > limit and cur:
            out.append(cur)
            cur, curw = '', 0
        cur += ch
        curw += cw
    out.append(cur)
    return out


def collect_lines():
    """按顺序读取源码并展开为物理行（剔除空行，保证每页行数密度）"""
    lines = []
    for rel in FILE_ORDER:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            print(f'  [警告] 缺少文件：{rel}', file=sys.stderr)
            continue
        lines.append(f'// ==================== 文件：{rel} ====================')
        with open(path, 'r', encoding='utf-8') as f:
            for raw in f.read().split('\n'):
                # 归一化制表符，避免 Word 中占位异常
                line = raw.replace('\t', '    ').rstrip('\r')
                if line.strip() == '':
                    continue  # 剔除空行（纯格式归一化，不改动任何代码内容）
                lines.extend(hard_wrap(line))
    return lines


def set_run(run, mono=True):
    run.font.size = Pt(FONT_SIZE)
    run.font.name = 'Consolas' if mono else '宋体'
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts')
        rpr.append(rf)
    rf.set(qn('w:ascii'), 'Consolas' if mono else '宋体')
    rf.set(qn('w:hAnsi'), 'Consolas' if mono else '宋体')
    # 中文回落字体，保证 CJK 不串行
    rf.set(qn('w:eastAsia'), '宋体')


def add_code_paragraph(doc, text, first_of_page=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    pf.line_spacing = Pt(LINE_SPACING_PT)
    pf.widow_control = False
    if first_of_page:
        pf.page_break_before = True
    run = p.add_run(text)
    set_run(run)
    return p


def setup_section(section, header_text):
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(MARGIN_CM)
    section.bottom_margin = Cm(MARGIN_CM)
    section.left_margin = Cm(MARGIN_CM)
    section.right_margin = Cm(MARGIN_CM)
    section.header_distance = Cm(0.7)
    section.footer_distance = Cm(0.7)

    # 页眉
    hp = section.header.paragraphs[0]
    hp.text = ''
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = hp.add_run(header_text)
    r.font.size = Pt(8)
    r.font.name = '宋体'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    # 页脚页码
    fp = section.footer.paragraphs[0]
    fp.text = ''
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = fp.add_run()
    r2.font.size = Pt(8)
    r2.font.name = '宋体'
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    r2._element.addnext(fld)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    all_lines = collect_lines()
    total = len(all_lines)

    need = LINES_PER_PAGE * PAGES_PER_PART  # 每部分 1500 行
    # 第三十页末插入一行“后 30 页”起始标记，故后段取 need-1 行真实源码，
    # 使正文恒为 60 页 × 50 行 = 3000 行
    marker = '// -------------------- 以下为源程序末尾 30 页 --------------------'

    head = all_lines[:need]
    tail = all_lines[-(need - 1):]
    body_lines = head + [marker] + tail

    print(f'源码物理总行数: {total}')
    print(f'前段 {len(head)} 行 + 标记 1 行 + 后段 {len(tail)} 行 = {len(body_lines)} 行')
    print(f'预计页数: {len(body_lines) / LINES_PER_PAGE:.0f} 页（每页 {LINES_PER_PAGE} 行）')

    doc = Document()
    # 默认模板自带一个空段落，先清除，避免多占一行
    body = doc.element.body
    for p in body.findall(qn('w:p')):
        body.remove(p)

    style = doc.styles['Normal']
    style.font.name = 'Consolas'
    style.font.size = Pt(FONT_SIZE)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    sec1 = doc.sections[0]
    setup_section(sec1, f'{SOFTWARE_NAME} {VERSION}    源程序')

    for i, line in enumerate(body_lines):
        add_code_paragraph(doc, line, first_of_page=(i > 0 and i % LINES_PER_PAGE == 0))

    doc.save(OUT)
    print(f'已生成：{OUT}')


if __name__ == '__main__':
    main()