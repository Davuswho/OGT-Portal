'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
for(const dir of ['lib','api']) for(const file of fs.readdirSync(dir)) if(file.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(dir,file),'utf8'),{filename:path.join(dir,file)});
new vm.Script(fs.readFileSync('public/vendor/wc-ethereum-provider.bundle.js','utf8'));
console.log('Source and bundled JavaScript syntax checked.');