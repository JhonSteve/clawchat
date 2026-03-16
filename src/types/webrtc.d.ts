// WebRTC Type Declarations for Node.js environment
// These types are used for signaling messages that reference WebRTC structures

declare global {
  interface RTCSessionDescriptionInit {
    type: RTCSdpType;
    sdp: string;
  }

  interface RTCIceCandidateInit {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string;
  }

  interface RTCIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
  }

  type RTCSdpType = "offer" | "answer" | "pranswer" | "rollback";
}

export {};