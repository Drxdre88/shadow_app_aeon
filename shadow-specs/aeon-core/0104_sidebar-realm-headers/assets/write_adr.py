
import pathlib
target = pathlib.Path('C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon/shadow-specs/aeon-core/0104_sidebar-realm-headers/assets/architecture_adr_0104_1045.md')
parts = []
for f in sorted(pathlib.Path('C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon/shadow-specs/aeon-core/0104_sidebar-realm-headers/assets').glob('part_*.txt')):
    parts.append(f.read_text(encoding='utf-8'))
target.write_text(''.join(parts), encoding='utf-8')
print(f'Combined {len(parts)} parts')
