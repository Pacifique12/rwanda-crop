import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
  Alert,
  Keyboard,
  Image,
  Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { collection, query, onSnapshot, addDoc, Timestamp, orderBy, where } from 'firebase/firestore';
import { db, auth, storage } from '@/services/config';
import { Ionicons } from '@expo/vector-icons';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

interface Expert {
  id: string;
  name: string;
}

interface Message {
  text?: string;
  imageUrl?: string;
  timestamp: Timestamp;
  sender: string;
}

const FarmerChatScreen = () => {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState<string>('');
  const [loadingMessages, setLoadingMessages] = useState<boolean>(true);
  const [showChat, setShowChat] = useState<boolean>(false);
  const [selectedExpert, setSelectedExpert] = useState<Expert | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const user = auth.currentUser;
  const [chatId, setChatId] = useState<string | null>(null);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    fetchExperts();
  }, []);

  const fetchExperts = () => {
    const expertsQuery = query(collection(db, 'farmers'), where('role', '==', 'Expert'));
    const unsubscribe = onSnapshot(
      expertsQuery,
      (snapshot) => {
        const expertList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Expert[];
        setExperts(expertList);
      },
      (error) => {
        console.error('Error fetching experts:', error);
        Alert.alert('Error', 'Failed to load experts.');
      }
    );

    return () => unsubscribe();
  };

  const handleExpertSelect = (expert: Expert) => {
    if (!user) {
      Alert.alert('Not Authenticated', 'You need to log in to chat.');
      return;
    }

    const generatedChatId = generateChatId(user.uid, expert.id);
    setChatId(generatedChatId);
    setSelectedExpert(expert);
    fetchMessages(generatedChatId);
    setShowChat(true);
  };

  const generateChatId = (uid1: string, uid2: string): string => {
    return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
  };

  const fetchMessages = (chatId: string) => {
    setLoadingMessages(true);
    const messagesQuery = query(collection(db, `chats/${chatId}/messages`), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const messagesList = snapshot.docs.map((doc) => doc.data() as Message);
        setMessages(messagesList);
        setLoadingMessages(false);
      },
      (error) => {
        console.error('Error fetching messages:', error);
        setLoadingMessages(false);
        Alert.alert('Error', 'Failed to load messages.');
      }
    );

    return () => unsubscribe();
  };

  const sendMessage = async () => {
    if (!message && !image) {
      Alert.alert('Empty Message', 'Please enter a message or select an image.');
      return;
    }

    if (!chatId || !user) {
      Alert.alert('No Chat Selected', 'Please select an expert to chat with.');
      return;
    }

    setSendingMessage(true);

    try {
      const messageData: Message = {
        text: message.trim() || undefined,
        timestamp: Timestamp.now(),
        sender: user.uid,
      };

      if (image) {
        const imageUrl = await uploadImage(image);
        messageData.imageUrl = imageUrl;
      }

      await addDoc(collection(db, `chats/${chatId}/messages`), messageData);
      setMessage('');
      setImage(null);
      Keyboard.dismiss();
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleImagePick = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission required', 'Permission to access camera roll is required!');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled && result.assets) {
      setImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri: string) => {
    const blob = await fetch(uri).then((response) => response.blob());
    const storageRef = ref(storage, `images/${Date.now()}_${user?.uid}.jpg`);
    const uploadTask = uploadBytesResumable(storageRef, blob);

    return new Promise<string>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        () => {},
        (error) => {
          console.error('Image upload failed:', error);
          reject('Error uploading image. Please try again.');
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadUrl);
        }
      );
    });
  };

  const handleImagePress = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setModalVisible(true);
  };

  const renderMessagesList = () => (
    <FlatList
      data={messages}
      keyExtractor={(item, index) => index.toString()}
      renderItem={({ item }) => (
        <View style={[styles.messageCard, item.sender === user?.uid ? styles.userMessage : styles.otherMessage]}>
          {item.text && <Text>{item.text}</Text>}
          {item.imageUrl && (
            <TouchableOpacity onPress={() => handleImagePress(item.imageUrl)}>
              <Image source={{ uri: item.imageUrl }} style={styles.imageMessage} />
            </TouchableOpacity>
          )}
          <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
        </View>
      )}
      style={styles.messagesList}
      contentContainerStyle={styles.messagesContainer}
    />
  );

  const formatTimestamp = (timestamp: Timestamp): string => {
    const date = timestamp.toDate();
    return date.toLocaleString();
  };

  return (
    <SafeAreaView style={styles.container}>
      {showChat ? (
        <>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => setShowChat(false)} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="green" />
            </TouchableOpacity>
            <Text style={styles.expertName}>Chat with {selectedExpert?.name}</Text>
          </View>

          {loadingMessages ? <ActivityIndicator size="large" color="green" /> : renderMessagesList()}

          <View style={styles.inputContainer}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Type your message"
              style={styles.messageInput}
            />
            <TouchableOpacity onPress={handleImagePick} style={styles.imagePickerButton}>
              <Ionicons name="image" size={24} color="green" />
            </TouchableOpacity>
            <TouchableOpacity onPress={sendMessage} style={styles.sendButton} disabled={sendingMessage}>
              {image && <Image source={{ uri: image }} style={styles.previewImage} />}
              <Ionicons name="send" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {selectedImage && (
            <Modal visible={modalVisible} transparent={true} onRequestClose={() => setModalVisible(false)}>
              <View style={styles.modalContainer}>
                <Image source={{ uri: selectedImage }} style={styles.fullScreenImage} />
                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </Modal>
          )}
        </>
      ) : (
        <FlatList
          data={experts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleExpertSelect(item)} style={styles.expertItem}>
              <Text>{item.name}</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.expertList}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#f0f0f0' },
  backButton: { marginRight: 10 },
  expertName: { fontSize: 18, fontWeight: 'bold' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#fff' },
  messageInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, padding: 10, marginRight: 10 },
  imagePickerButton: { marginRight: 10 },
  sendButton: { backgroundColor: 'green', padding: 10, borderRadius: 50 },
  messagesList: { flex: 1 },
  messagesContainer: { padding: 10 },
  messageCard: { padding: 10, borderRadius: 8, marginBottom: 10 },
  userMessage: { alignSelf: 'flex-end', backgroundColor: '#dcf8c6' },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: '#f0f0f0' },
  timestamp: { fontSize: 10, color: '#555', marginTop: 5 },
  expertItem: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#ccc' },
  imageMessage: { width: 150, height: 150, marginTop: 10 },
  previewImage: { width: 30, height: 30, borderRadius: 15 },
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
  fullScreenImage: { width: '90%', height: '70%' },
  closeButton: { position: 'absolute', top: 30, right: 30, padding: 10, backgroundColor: 'green', borderRadius: 20 },
  closeButtonText: { color: '#fff', fontSize: 16 },
});

export default FarmerChatScreen;
