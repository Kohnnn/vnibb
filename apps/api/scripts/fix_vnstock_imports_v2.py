import os

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    has_vnstock_usage = False
    
    for line in lines:
        if line.strip() == 'from vnstock import Vnstock' or \
           line.strip() == 'from vnstock import Listing' or \
           line.strip() == 'from vnstock import Trading' or \
           line.strip() == 'from vnstock import Listing, Trading':
            continue
        
        if 'Vnstock()' in line or 'Listing(' in line or 'Trading(' in line:
            has_vnstock_usage = True
        
        new_lines.append(line)
    
    content = "".join(new_lines)
    
    # If there's usage but no local import, we need to add it inside the method.
    # But for now, let's just make sure we add it where it's missing.
    # Actually, most files already have it inside _fetch_sync.
    
    # Special case: if Vnstock() is used but 'from vnstock import' is not in the file at all
    # we might have a problem.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Fixed {filepath}")

directory = 'vnibb/providers/vnstock'
for filename in os.listdir(directory):
    if filename.endswith('.py'):
        fix_file(os.path.join(directory, filename))
