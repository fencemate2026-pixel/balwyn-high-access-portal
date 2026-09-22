import { readFileSync, writeFileSync } from "node:fs";
const files=["SOFTWARE_HELP.md","README.md","LOGIN_AND_ADMIN_SETUP.md","AI_REFERENCE_MASTER.md","PRODUCT.md","controller-agent/README.md","pi-door-service/README.md"];
const entries=[];
for(const source of files){const text=readFileSync(source,"utf8");let title=source;for(const part of text.split(/(?=^#{1,3} )/m)){if(!part.trim())continue;const heading=part.match(/^#{1,3} (.+)/)?.[1];if(heading)title=heading;for(let offset=0;offset<part.length;offset+=3500)entries.push({id:`doc-${entries.length+1}`,title,source,text:part.slice(offset,offset+3500)})}}
writeFileSync("data/software-knowledge.json",JSON.stringify(entries,null,2)+"\n");console.log(`Indexed ${files.length} guides in ${entries.length} passages`);
