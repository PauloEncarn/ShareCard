from pathlib import Path
p=Path('app/organizer.tsx')
s=p.read_text(encoding='utf-8').replace("{tab === 'people' && <p>O portador do cartão pode ser diferente de quem paga a compra.</p>}", '')
s=s.replace("import Link from 'next/link';\n",'').replace("const STORAGE_KEY = 'fatura-em-dia:v1';\n",'')
p.write_text(s,encoding='utf-8')
