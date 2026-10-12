#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成《计算机软件著作权登记申请表》填写稿（Word）

说明（重要）：
  原始附件 申请表.doc 为 Word 97-2003 二进制格式，仅能抽取正文文本，
  未能获得其原始表格版式与勾选框。故本文件为【按官方字段名重建的填写稿】，
  字段顺序与名称依据 S001 抽取文本，填写内容依据 evidence-ledger 中的已登记事实。
  未能确证的字段一律标注【待确认】并给出建议值，不做推定。
"""
import os
import re
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

OUT = '/workspace/ip-work/dangjian-taizhang-v353/software-copyright/delivery/党建工作台账_软件著作权登记申请表（填写稿）.docx'

doc = Document()


def init():
    st = doc.styles['Normal']
    st.font.name = '宋体'
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    st.paragraph_format.line_spacing = 1.4
    for sec in doc.sections:
        sec.page_width = Cm(21.0)
        sec.page_height = Cm(29.7)
        sec.top_margin = Cm(2.2)
        sec.bottom_margin = Cm(2.0)
        sec.left_margin = Cm(2.4)
        sec.right_margin = Cm(2.4)


def title(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(17)
    r.font.name = '黑体'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')
    p.paragraph_format.space_after = Pt(6)


def note(text, color=(0x99, 0x33, 0x00)):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(9)
    r.font.name = '宋体'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    r.font.color.rgb = RGBColor(*color)
    p.paragraph_format.space_after = Pt(10)


def h(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(13)
    r.font.name = '黑体'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(6)


def set_cell(cell, text, bold=False, size=10.5, center=False, color=None):
    cell.text = ''
    p = cell.paragraphs[0]
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.25
    r = p.add_run(text)
    r.bold = bold
    r.font.size = Pt(size)
    r.font.name = '宋体'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    if color:
        r.font.color.rgb = RGBColor(*color)


def kv_table(rows, w1=4.2, w2=12.0):
    """两列表格：字段名 | 填写内容"""
    t = doc.add_table(rows=0, cols=2)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for k, v in rows:
        cells = t.add_row().cells
        set_cell(cells[0], k, bold=True)
        set_cell(cells[1], v)
        cells[0].width = Cm(w1)
        cells[1].width = Cm(w2)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


TBD = '【待确认】'


def charcount(text):
    """统计字符数（不含换行）"""
    return len(re.sub(r'\s', '', text))


# ==================== 内容定义 ====================
FUNC = (
    '本软件是一款面向基层党组织的党建工作台账管理软件，围绕党员信息、党内会议记录、谈心谈话记录三类核心台账数据，'
    '提供信息录入维护、出勤统计、数据可视化、组织架构展示、台账导出、数据备份恢复与多端数据融合等能力，主要功能如下：\n'
    '（1）人员管理：支持党员信息的新增、编辑、删除、批量删除与批量导入，导入时提供模板并可检测同名人员；'
    '可维护姓名、部室、部门/支部、联系电话、党小组、支委职务、是否担任党小组组长等信息；'
    '支持在职、调离、借调、离职四种人员状态，并按日期记录状态变更历史，可对变更记录进行修改、删除与补充，'
    '同时自动留存人员信息变更痕迹。\n'
    '（2）会议管理：支持支部党员大会、支部委员会、党小组会、党课、组织生活会、民主生活会、主题党日活动、'
    '青年理论学习小组学习会及其他会议等多种会议类型的记录；会议类型可多选，以记录合并召开的会议，'
    '选择党小组会时联动选择所属党小组；支持将参会接龙文本智能识别为参会名单，并自动识别出席、请假、缺席、列席等状态；'
    '提供一键全选在职人员、按支委委员或党小组选择人员等快捷操作；可逐人维护出席情况、请假原因与列席标记，'
    '并对未加入名单的在职人员给出提示。\n'
    '（3）出勤统计：按会议日期时点判定人员在当时是否在职，调离、借调、离职期间不计入考勤，'
    '离开前及回归后的会议照常计入；列席人员计入出席，未匹配人员库的临时人员不计入；'
    '统计口径在数据看板、会议列表与导出台账之间保持一致。\n'
    '（4）数据看板：按年度查看会议总数、平均出勤率、在职党员总数、本月会议数等关键指标，'
    '并提供会议类型分布、月度会议趋势、党员出勤率排行、出勤对比（支持党小组、部室、部门/支部三个维度切换）'
    '与月度谈心谈话趋势等图表；在职党员总数按所选年度时点统计，随人员状态变化自动更新；支持导出 Word 统计报告。\n'
    '（5）组织架构：以树状图自上而下展示支部书记、副书记、支部委员会成员与各党小组的当前组织架构，'
    '各层级显示当前任职人员姓名；党小组显示人数统计，可展开查看组员姓名与所在部室，并对党小组组长进行标记；'
    '数据随人员管理信息实时更新。\n'
    '（6）谈心谈话：支持个别谈话、集体谈话、组织约谈三种谈话方式的记录管理，可记录谈话类型、'
    '谈话人与谈话对象及其职务、联系人、谈话日期与时段、谈话提纲与内容、谈话地点、是否属于"五必谈"及备注等信息，'
    '并支持台账导出。\n'
    '（7）数据管理：支持 JSON 与 Excel 两种格式的数据备份与恢复，备份范围可选全部数据、仅会议记录或仅谈心谈话；'
    '支持将党小组组长导出或填报的数据融合到管理端，按记录标识去重且不覆盖本机已有数据，并提供组长填报模板下载；'
    '支持定时自动备份与定时自动融合；支持数据重置。\n'
    '（8）操作日志：自动记录人员、会议、谈话、导出、备份、恢复、融合等关键操作，'
    '包含操作时间、类型、描述、详情与结果，支持按类型与时间范围检索。'
)

FEATURE = (
    '桌面应用、数据本地存储、无需服务器；出勤按会议日期时点判定在职；会议次数按套会拆开计次；'
    '参会组织信息快照留存；支持 JSON/Excel 双格式备份与多端数据融合。'
)

PURPOSE = '规范基层党组织人员、会议与谈心谈话台账记录，自动统计出勤数据并可视化展示，减少手工统计差错。'
FIELD_AREA = '面向基层党组织党务工作，适用于机关、企事业单位党支部的党建工作台账管理与统计。'

RADIO_ON = '☑ '
RADIO_OFF = '☐ '

init()
title('计算机软件著作权登记申请表（填写稿）')
note('填写说明：本填写稿依据官方申请表的字段名称与填写要求整理，勾选项以 ☑ 标注、未选项以 ☐ 标注；'
     '标注【待确认】的字段因缺乏权属或时间事实依据，未作推定，请确认后填写。'
     '提交前建议以登记机构最新版式誊录核对。')

# ---------- 一、软件基本信息 ----------
h('一、软件基本信息')
kv_table([
    ('软件名称（全称）', f'党建工作台账管理系统　{TBD}（建议值；原产品名为"党建工作台账"，'
                        '按官方"全称需以系统、软件或平台等词结尾"的要求拟定，请确认）'),
    ('版本号', 'V3.5.3'),
    ('软件简称', '党建工作台账'),
    ('软件分类', f'{RADIO_ON}应用软件　{RADIO_OFF}嵌入式软件　{RADIO_OFF}中间件　{RADIO_OFF}操作系统'),
    ('软件作品说明',
     f'{RADIO_ON}原创　{RADIO_OFF}修改（含翻译软件、合成软件）\n'
     '原登记号：不适用　｜　修改（翻译或合成）软件作品说明：不适用'),
    ('开发完成日期', f'2026 年 09 月 25 日　{TBD}（建议采用 3.5.3 版本发布日，请确认）'),
    ('发表状态',
     f'{RADIO_ON}已发表\n'
     f'　　首次发表日期：2026 年 08 月 24 日　{TBD}（可证据的最早公开发布为 v3.2.0，请确认）\n'
     f'　　首次发表地点：{TBD}\n'
     f'{RADIO_OFF}未发表（☐ 允许公众查询）'),
    ('开发方式',
     f'{RADIO_OFF}独立开发　{RADIO_OFF}合作开发　{RADIO_OFF}委托开发　{RADIO_OFF}下达任务开发　{TBD}（请勾选）'),
])

h('著作权人')
kv_table([
    ('姓名或名称', TBD),
    ('类别', f'{RADIO_OFF}单位　{RADIO_OFF}个人　{TBD}'),
    ('证件类型 / 证件号码', TBD),
    ('国籍 / 省份·城市', TBD),
    ('园区', '（如有）'),
])

# ---------- 二、软件功能和技术特点 ----------
h('二、软件功能和技术特点')
kv_table([
    ('开发的硬件环境', f'x86_64 架构个人计算机　{TBD}（按开发机实际配置复核）'),
    ('运行的硬件环境', 'x86_64 架构个人计算机；建议内存 4GB 及以上，磁盘剩余空间 500MB 及以上'),
    ('开发该软件的操作系统', f'Windows 10 / Windows 11（64 位）　{TBD}（按开发机实际系统复核）'),
    ('软件开发环境 / 开发工具',
     'Node.js 20、TypeScript 编译器、Vite 8、Electron 39、electron-builder 26、Visual Studio Code'),
    ('该软件的运行平台 / 操作系统', 'Windows 10 / Windows 11（64 位）'),
    ('软件运行支撑环境 / 支持软件',
     '无需额外安装数据库或中间件，软件内置本地数据存储；导出 Word / Excel 文件时建议本机安装可打开 '
     '.docx / .xlsx 的办公软件'),
    ('编程语言', 'TypeScript、JavaScript、CSS、HTML'),
    ('源程序总量', '10,796 行（统计范围：src/ 与 electron/ 目录下的 .ts、.tsx、.css、.cjs 代码文件）'),
    ('开发目的', f'{PURPOSE}（共 {charcount(PURPOSE)} 字）'),
    ('面向领域 / 行业', f'{FIELD_AREA}（共 {charcount(FIELD_AREA)} 字）'),
])
kv_table([('软件的主要功能', FUNC)], w1=4.2, w2=12.0)
note(f'　　软件的主要功能：共 {charcount(FUNC)} 字（官方要求 500 字以上，已满足）。')
kv_table([('软件的技术特点', f'{FEATURE}（共 {charcount(FEATURE)} 字）')])
note(f'　　软件的技术特点：共 {charcount(FEATURE)} 字（官方要求 100 字以内，已满足）。')

# ---------- 三、申请人信息 ----------
h('三、申请人信息')
kv_table([
    ('申请方式', f'{RADIO_OFF}由著作权人申请　{RADIO_OFF}由代理人申请　{TBD}（请勾选）'),
    ('姓名或名称', TBD),
    ('电话 / 手机', TBD),
    ('详细地址 / 邮编', TBD),
    ('联系人', TBD),
    ('E-mail / 传真', TBD),
])

# ---------- 附：代办事项 ----------
h('附：需著作权人补充确认的事项')
note('以下事项无材料依据，未作填写，详见 questions.md：\n'
     '1. 软件名称（全称）是否采用"党建工作台账管理系统"；\n'
     '2. 著作权人名称/类别/证件类型与号码/国籍/省份城市；\n'
     '3. 是否已发表、首次发表日期与地点（可证据的最早发布为 2026-08-24）；\n'
     '4. 开发方式（独立/合作/委托/下达任务）；\n'
     '5. 开发完成日期是否采用 2026-09-25；\n'
     '6. 申请方式（著作权人申请 / 代理人申请）及申请人联系方式。', color=(0x66, 0x66, 0x66))

doc.save(OUT)
print(f'已生成：{OUT}')
print(f'  开发目的 {charcount(PURPOSE)} 字（限 50）')
print(f'  面向领域 {charcount(FIELD_AREA)} 字（限 50）')
print(f'  主要功能 {charcount(FUNC)} 字（需 ≥500）')
print(f'  技术特点 {charcount(FEATURE)} 字（限 100）')