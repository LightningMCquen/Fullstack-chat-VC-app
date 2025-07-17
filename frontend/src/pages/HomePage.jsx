import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";

import Sidebar from "../components/Sidebar";
import NoChatSelected from "../components/NoChatSelected";
import ChatContainer from "../components/ChatContainer";
import VideoCall from "../components/VideoCall";

const HomePage = () => {
  const { selectedUser } = useChatStore();
  // Destructure callAccepted, callEnded, and receivingCall from useAuthStore
  const { callAccepted, callEnded, receivingCall } = useAuthStore(); 

  return (
    <div className="h-screen bg-base-200">
      <div className="flex items-center justify-center pt-20 px-4">
        <div className="bg-base-100 rounded-lg shadow-cl w-full max-w-6xl h-[calc(100vh-8rem)]">
          <div className="flex h-full rounded-lg overflow-hidden">
            <Sidebar />
            {!selectedUser ? <NoChatSelected /> : <ChatContainer />}
          </div>
        </div>
      </div>
      {/* Conditionally render VideoCall component based on call states */}
      {/* It will show if a call is being received OR if a call is accepted and not yet ended */}
      {(receivingCall || (callAccepted && !callEnded)) && (
        <VideoCall onCallEnd={() => {}} />
      )}
    </div>
  );
};

export default HomePage;
