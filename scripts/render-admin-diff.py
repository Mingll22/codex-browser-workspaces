#!/usr/bin/env python3
"""Render a reviewable diff; never writes Codex configuration."""
import argparse,pathlib,tomllib,json,re,difflib,shutil
p=argparse.ArgumentParser();p.add_argument('--install-dir',default=str(pathlib.Path.home()/'.local/share/codex-browser-workspaces'));p.add_argument('--state-dir',default=str(pathlib.Path.home()/'.local/state/codex-browser-workspaces'));p.add_argument('--output',default='.artifacts/admin-profile-diff.patch');a=p.parse_args()
allowed=set('navigate_page take_snapshot take_screenshot click hover fill fill_form drag press_key type_text wait_for evaluate_script handle_dialog emulate list_network_requests get_network_request list_console_messages get_console_message upload_file close_page list_pages'.split())
output=[]
for profile in ['code','design','admin']:
 path=pathlib.Path.home()/'.codex'/f'{profile}.config.toml';before=path.read_text();config=tomllib.loads(before)
 old=config['mcp_servers']['chrome-devtools'];tools=[name for name in old.get('enabled_tools',sorted(allowed)) if name in allowed]
 for name in ['open_page','set_page_retention','reset_workspace']:
  if name not in tools:tools.append(name)
 match=re.search(r'^\[mcp_servers\.chrome-devtools\]\n[\s\S]*?(?=^\[|\Z)',before,re.M)
 if not match:raise RuntimeError('No raw Chrome entry in '+str(path))
 block=match.group();block=re.sub(r'^command\s*=.*$', 'command = '+json.dumps(shutil.which('node')),block,flags=re.M)
 block=re.sub(r'^args\s*=.*\n','',block,flags=re.M)
 line='args = '+json.dumps([str(pathlib.Path(a.install_dir)/'dist/adapter/src/stdio.js'),str(pathlib.Path(a.state_dir)/'config.json')])+'\n'
 block=block.replace('[mcp_servers.chrome-devtools]\n','[mcp_servers.chrome-devtools]\n'+line)
 entry='enabled_tools = '+json.dumps(tools,ensure_ascii=False,indent=2)
 if 'enabled_tools' in block:block=re.sub(r'enabled_tools\s*=\s*\[[\s\S]*?\]',lambda _:entry,block,count=1)
 else:block+='\n'+entry+'\n'
 after=before[:match.start()]+block+before[match.end():]
 tomllib.loads(after)
 output.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile=str(path),tofile=str(path)))
pathlib.Path(a.output).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(a.output).write_text(''.join(output));print(a.output)
