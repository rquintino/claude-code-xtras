local pagebreak = pandoc.RawBlock('openxml',
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

-- Spacing: an empty paragraph that acts as a visual line break (spacer).
local spacer = pandoc.RawBlock('openxml',
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="auto"/></w:pPr></w:p>')

-- Convert \newpage to a docx page break.
function RawBlock(el)
  if el.format == 'tex' and el.text:match('\\newpage') then
    return pagebreak
  end
end

-- Insert spacer paragraphs between consecutive blocks to restore
-- the visual blank lines that the template style strips.
function Pandoc(doc)
  local newblocks = {}
  for i, block in ipairs(doc.blocks) do
    -- Insert a spacer between consecutive paragraphs where the source had
    -- a blank line (pandoc collapses blank lines into separate Para blocks,
    -- but the template style may have 0pt after-spacing).
    if i > 1 and (block.t == 'Para' or block.t == 'Header'
         or block.t == 'CodeBlock' or block.t == 'BulletList'
         or block.t == 'OrderedList' or block.t == 'BlockQuote'
         or block.t == 'Table') then
      local prev = doc.blocks[i - 1]
      if prev.t == 'Para' or prev.t == 'Header' or prev.t == 'CodeBlock'
         or prev.t == 'BlockQuote' or prev.t == 'BulletList'
         or prev.t == 'OrderedList' or prev.t == 'HorizontalRule'
         or prev.t == 'Table' then
        table.insert(newblocks, spacer)
      end
    end
    table.insert(newblocks, block)
  end
  doc.blocks = newblocks
  return doc
end

-- Convert H3+ headings to bold paragraphs so they don't appear in Word
-- navigation pane. Only H1 (Parts) and H2 (Labs) remain as real headings.
function Header(el)
  if el.level >= 3 then
    local bold = pandoc.Strong(el.content)
    return pandoc.Para({bold})
  end
  return el
end

-- Center paragraphs that contain only an image.
function Para(el)
  if #el.content == 1 and el.content[1].t == 'Image' then
    table.insert(el.content, 1,
      pandoc.RawInline('openxml', '<w:pPr><w:jc w:val="center"/></w:pPr>'))
    return el
  end
  return el
end

-- Style code blocks with grey background and monospace font in docx.
function CodeBlock(el)
  local function escape_xml(s)
    return s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  end

  local pPr = '<w:pPr>'
    .. '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>'
    .. '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
    .. '</w:pPr>'

  local rPr = '<w:rPr>'
    .. '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
    .. '<w:sz w:val="18"/><w:szCs w:val="18"/>'
    .. '</w:rPr>'

  -- First line gets spacing before, last line gets spacing after
  local pPrFirst = '<w:pPr>'
    .. '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>'
    .. '<w:spacing w:before="120" w:after="0" w:line="240" w:lineRule="auto"/>'
    .. '</w:pPr>'

  local pPrLast = '<w:pPr>'
    .. '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>'
    .. '<w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/>'
    .. '</w:pPr>'

  local rawLines = {}
  for line in (el.text .. '\n'):gmatch('(.-)\n') do
    local text = escape_xml(line)
    if text == '' then text = ' ' end
    table.insert(rawLines, text)
  end

  local lines = {}
  for i, text in ipairs(rawLines) do
    local curPPr = pPr
    if i == 1 and #rawLines == 1 then
      -- Single line: spacing before and after
      curPPr = '<w:pPr>'
        .. '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>'
        .. '<w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>'
        .. '</w:pPr>'
    elseif i == 1 then
      curPPr = pPrFirst
    elseif i == #rawLines then
      curPPr = pPrLast
    end
    table.insert(lines,
      '<w:p>' .. curPPr
      .. '<w:r>' .. rPr
      .. '<w:t xml:space="preserve">' .. text .. '</w:t>'
      .. '</w:r></w:p>')
  end

  return pandoc.RawBlock('openxml', table.concat(lines, '\n'))
end

-- Convert Plain to Para in table cells (removes compact style).
function Table(el)
  local function patch_cells(rows)
    for _, row in ipairs(rows) do
      for _, cell in ipairs(row.cells) do
        local new_content = {}
        for _, block in ipairs(cell.contents) do
          if block.t == 'Plain' then
            table.insert(new_content, pandoc.Para(block.content))
          else
            table.insert(new_content, block)
          end
        end
        cell.contents = new_content
      end
    end
  end
  if el.head and el.head.rows then
    patch_cells(el.head.rows)
  end
  for _, body in ipairs(el.bodies) do
    patch_cells(body.body)
  end
  return el
end

-- Remove "Compact" list variants so pandoc uses normal paragraph spacing.
function BulletList(el)
  for i, item in ipairs(el.content) do
    for j, block in ipairs(item) do
      if block.t == 'Plain' then
        item[j] = pandoc.Para(block.content)
      end
    end
  end
  return el
end

function OrderedList(el)
  for i, item in ipairs(el.content) do
    for j, block in ipairs(item) do
      if block.t == 'Plain' then
        item[j] = pandoc.Para(block.content)
      end
    end
  end
  return el
end
