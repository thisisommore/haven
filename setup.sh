# 0. verify update files (inline, no function)
for f in dm.ts webpack.config.js tsconfig.json; do
  if [ ! -f "$f" ]; then
    echo "Error: '$f' not found in $(pwd). Please add it here and re-run."
    return 1
  fi
done

# 1. workspace & clone
mkdir -p xx_network && cd xx_network
git clone https://git.xx.network/elixxir/client.git    client
git clone https://git.xx.network/elixxir/ekv.git       ekv
git clone https://git.xx.network/elixxir/xxdk-wasm.git xxdk-wasm
git clone https://github.com/thisisommore/haven.git     haven
git clone https://github.com/thisisommore/xxnetwork-secure-extension.git extension

# 2. checkout branches
cd client    && git checkout 11-22-implement-kv-interface-defined-in-collectiveversionedkvgo  && cd ..
cd ekv       && git checkout 11-22-implement-kv-interface-defined-in-collectiveversionedkvgo  && cd ..
cd xxdk-wasm && git checkout 11-22-implement-kv-interface-defined-in-collectiveversionedkvgo  && cd ..
cd haven     && git checkout 5-add-window-object-and-extension-detection-gitpod               && cd ..
cd extension && git checkout 11-lock-extension-by-default-and-dont-allow-any-api-while-locked && cd ..

# 3. build extension
cd extension
pnpm install
pnpm run build
cd ..

# 4. patch go.mod
echo "replace gitlab.com/elixxir/client/v4 => ../client" >> xxdk-wasm/go.mod
echo "replace gitlab.com/elixxir/ekv => ../ekv"           >> xxdk-wasm/go.mod
echo "replace gitlab.com/elixxir/ekv => ../ekv"           >> client/go.mod

# 5. add git URL rewrites
printf '\n[url "https://git.xx.network/elixxir"]\n'\
'    insteadOf = https://gitlab.com/elixxir\n'\
'    insteadOf = https://git.xx.network/elixxir\n'\
'[url "https://git.xx.network/xx_network"]\n'\
'    insteadOf = https://gitlab.com/xx_network\n'\
'    insteadOf = https://git.xx.network/xx_network\n' \
>> ~/.gitconfig

# 6. copy your updates
cp ../dm.ts             xxdk-wasm/src/events/dm.ts
cp ../webpack.config.js xxdk-wasm/webpack.config.js
cp ../tsconfig.json     xxdk-wasm/tsconfig.json

# 7. build & link xxdk-wasm
cd xxdk-wasm
npm install
npm run build
bun link

# 8. link into haven
cd ../haven
bun link xxdk-wasm

# 9. manual step: set EXT_ID and start dev
cat <<EOF

👉  Please open:
    haven/src/components/common/WebAssemblyRunner/haven-storage-extension.ts
  update the constant EXT_ID (around line 50) to your extension's ID.

Then run:
  npm run dev

EOF
