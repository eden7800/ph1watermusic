const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src/renderer/src/components/MainLayout.tsx')
let content = fs.readFileSync(filePath, 'utf8')

// YouTube 자막 분기 처리가 안 된 가사 패널 섹션 교체
const oldLyricsPanel = `                    <div className="flex-1 overflow-y-auto pr-4 lg:pr-10 custom-scrollbar scroll-smooth" ref={lyricsContainerRef}>
                       <div className="space-y-6 lg:space-y-8 pb-40 lg:pb-60 text-center lg:text-left">
                         {parsedLrc.length > 0 ? (
                           parsedLrc.map((line, idx) => (
                             <p 
                               key={idx} 
                               className={\`font-black transition-all duration-700 cursor-pointer leading-[1.3] lg:origin-left \${
                                 idx === activeLineIndex 
                                   ? 'text-[22px] lg:text-[34px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]' 
                                   : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50 blur-[0.3px] hover:blur-0'
                               }\`} 
                               onClick={() => seek(line.time)}
                             >
                               {line.text || ' '}
                             </p>
                           ))
                         ) : (
                           <div className="h-full flex flex-col items-center lg:items-start justify-center text-white/20 pt-10">
                             <p className="text-xl font-black italic tracking-tighter opacity-20">
                               {currentTrack?.isYouTube ? '유튜브 음악은 가사를 지원하지 않습니다.' : '가사가 없습니다.'}
                             </p>
                           </div>
                         )}
                       </div>
                    </div>`

const newLyricsPanel = `                    <div className="flex-1 overflow-y-auto pr-4 lg:pr-10 custom-scrollbar scroll-smooth" ref={lyricsContainerRef}>
                       <div className="space-y-6 lg:space-y-8 pb-40 lg:pb-60 text-center lg:text-left">
                         {currentTrack?.isYouTube ? (
                           ytSubtitles.length > 0 ? ytSubtitles.map((line, idx) => {
                             const isActive = currentTime >= line.start && currentTime < line.end
                             return (
                               <p key={idx}
                                 className={\`font-black transition-all duration-500 cursor-pointer leading-[1.3] lg:origin-left \${
                                   isActive
                                     ? 'text-[22px] lg:text-[32px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]'
                                     : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50'
                                 }\`}
                                 onClick={() => seek(line.start)}
                               >
                                 {line.text}
                               </p>
                             )
                           }) : (
                             <div className="h-full flex flex-col items-center lg:items-start justify-center text-white/20 pt-10">
                               <p className="text-xl font-black italic tracking-tighter opacity-20">
                                 {isSubLoading ? '자막 불러오는 중...' : '자막이 없습니다.'}
                               </p>
                             </div>
                           )
                         ) : (
                           parsedLrc.length > 0 ? (
                             parsedLrc.map((line, idx) => (
                               <p key={idx}
                                 className={\`font-black transition-all duration-700 cursor-pointer leading-[1.3] lg:origin-left \${
                                   idx === activeLineIndex
                                     ? 'text-[22px] lg:text-[34px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]'
                                     : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50 blur-[0.3px] hover:blur-0'
                                 }\`}
                                 onClick={() => seek(line.time)}
                               >
                                 {line.text || ' '}
                               </p>
                             ))
                           ) : (
                             <div className="h-full flex flex-col items-center lg:items-start justify-center text-white/20 pt-10">
                               <p className="text-xl font-black italic tracking-tighter opacity-20">가사가 없습니다.</p>
                             </div>
                           )
                         )}
                       </div>
                    </div>`

// Header 교체 (Lyrics -> Subtitles/Lyrics with loader)
const oldHeader = `                    <div className="hidden lg:flex gap-8 mb-6">
                      <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-white/30">Lyrics</h3>
                    </div>`

const newHeader = `                    <div className="hidden lg:flex items-center gap-3 mb-6">
                      <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-white/30">
                        {currentTrack?.isYouTube ? 'Subtitles' : 'Lyrics'}
                      </h3>
                      {isSubLoading && <Loader2 size={12} className="animate-spin text-white/30" />}
                    </div>`

let updated = content
if (content.includes(oldHeader)) {
  updated = updated.replace(oldHeader, newHeader)
  console.log('Header replaced OK')
} else {
  console.log('WARNING: Header not found - skipping')
}

if (updated.includes(oldLyricsPanel)) {
  updated = updated.replace(oldLyricsPanel, newLyricsPanel)
  console.log('Lyrics panel replaced OK')
} else {
  console.log('WARNING: Lyrics panel not found, trying normalized whitespace...')
  // Try with CRLF normalized
  const oldNorm = oldLyricsPanel.replace(/\r\n/g, '\n')
  const contentNorm = updated.replace(/\r\n/g, '\n')
  if (contentNorm.includes(oldNorm)) {
    const result = contentNorm.replace(oldNorm, newLyricsPanel)
    updated = result
    console.log('Lyrics panel replaced OK (normalized)')
  } else {
    console.log('FAILED: Could not find lyrics panel to replace')
    process.exit(1)
  }
}

fs.writeFileSync(filePath, updated, 'utf8')
console.log('File written successfully')
