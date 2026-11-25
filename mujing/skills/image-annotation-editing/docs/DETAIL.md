# 图片标注编辑

通过编号标注图片中的多个位置，再按标注生成编辑结果。

| Field | Value |
|---|---|
| Skill name | `image-annotation-editing` |
| Category | creative |
| Version | 1.0.0 |
| Author | 幕境 |
| Resources | — |

Once installed, any agent with the skill tool (such as the 幕境 Director) loads this skill on demand; invoke it manually with `/image-annotation-editing`.

## Full skill text

# 图片标注编辑

1. 先读取源图片，不要凭空猜测坐标或目标区域。
2. 使用画布已有标注编辑入口，让用户放置编号点并为每个点填写修改说明；未确认前不要生成。
3. 生成时只使用用户确认的点位和文字。prompt 应列出 Point 1、Point 2 等顺序要求，并明确标注图仅用于定位，最终结果不能保留编号、圆点或辅助线。
4. 原图必须作为第一张 referenceNode，标注预览图作为第二张 guide reference；调用 generate_media 并走现有审批。
5. 成功后创建新图片节点并连回源图；保留原图和用户标注，不覆盖历史结果。
