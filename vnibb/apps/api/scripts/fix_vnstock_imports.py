import os

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Remove top-level import
    new_content = content.replace('\nfrom vnstock import Vnstock\n', '\n')
    new_content = new_content.replace('\nfrom vnstock import Listing\n', '\n')
    new_content = new_content.replace('\nfrom vnstock import Trading\n', '\n')
    new_content = new_content.replace('\nfrom vnstock import Listing, Trading\n', '\n')
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Fixed {filepath}")

directory = 'vnibb/providers/vnstock'
for filename in os.listdir(directory):
    if filename.endswith('.py'):
        fix_file(os.path.join(directory, filename))
