import { AudioProvider } from './contexts/AudioContext'
import MainLayout from './components/MainLayout'

function App(): JSX.Element {
  return (
    <AudioProvider>
      <div className="h-screen w-full flex flex-col overflow-hidden">
        <MainLayout />
      </div>
    </AudioProvider>
  )
}

export default App
