import { useMemo, useState } from 'react'
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'

type HygieneMode = 'register' | 'action'
type HygieneStatus = '조치' | '미조치'

type PhotoCategory = {
  key: string
  title: string
}

type HygienePhoto = {
  id: string
  uri: string
}

type HygienePhotoSlot = HygienePhoto | null

type HygieneRecord = {
  id: string
  date: string
  clientName: string
  status: HygieneStatus
  createdAt: string
  categories: Record<string, HygienePhotoSlot[]>
  notes: Record<string, string>
  actionPhotos: HygienePhotoSlot[]
  actionNote: string
}

const PHOTO_LIMIT = 5

const photoCategories: PhotoCategory[] = [
  { key: 'kitchen', title: '주방사진' },
  { key: 'fridge', title: '냉장고 사진' },
  { key: 'healthCertificate', title: '보건증 사진' },
  { key: 'vendingMachine', title: '자판기 사진' },
  { key: 'businessLicense', title: '영업신고증 사진' },
  { key: 'worker', title: '근무자 사진' },
]

function createEmptyPhotoSlots() {
  return Array.from({ length: PHOTO_LIMIT }, () => null as HygienePhotoSlot)
}

function createEmptyCategoryMap() {
  return Object.fromEntries(
    photoCategories.map((category) => [category.key, createEmptyPhotoSlots()])
  )
}

function createEmptyNoteMap() {
  return Object.fromEntries(photoCategories.map((category) => [category.key, '']))
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function createMockRecord(
  id: string,
  date: string,
  clientName: string,
  status: HygieneStatus,
  noteSeed: string
): HygieneRecord {
  return {
    id,
    date,
    clientName,
    status,
    createdAt: `${date}T09:00:00`,
    categories: createEmptyCategoryMap(),
    notes: {
      kitchen: `${noteSeed} 주방 바닥과 조리대 정리 필요`,
      fridge: `${noteSeed} 냉장고 온도표 점검 필요`,
      healthCertificate: `${noteSeed} 보건증 유효기간 확인`,
      vendingMachine: `${noteSeed} 자판기 외부 청결 상태 양호`,
      businessLicense: `${noteSeed} 영업신고증 게시 위치 확인`,
      worker: `${noteSeed} 근무자 위생모 착용 점검`,
    },
    actionPhotos: createEmptyPhotoSlots(),
    actionNote: status === '조치' ? '현장 재점검 완료 후 조치 마감했습니다.' : '',
  }
}

function buildRecordTitle(record: Pick<HygieneRecord, 'date' | 'clientName'>) {
  return `${record.date} ${record.clientName} 위생일지`
}

function PhotoPickerSection({
  title,
  photos,
  note,
  notePlaceholder,
  onAddPhoto,
  onRemovePhoto,
  onChangeNote,
  readonly = false,
}: {
  title: string
  photos: HygienePhotoSlot[]
  note?: string
  notePlaceholder?: string
  onAddPhoto: (slotIndex: number) => void
  onRemovePhoto: (slotIndex: number) => void
  onChangeNote?: (value: string) => void
  readonly?: boolean
}) {
  const attachedPhotoCount = photos.filter(Boolean).length

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionCardTitle}>{title}</Text>
        <Text style={styles.sectionCardMeta}>
          {attachedPhotoCount}/{PHOTO_LIMIT}
        </Text>
      </View>

      <View style={styles.photoGrid}>
        {photos.map((photo, slotIndex) => (
          <View key={`${title}-${slotIndex}`} style={styles.photoTile}>
            <Pressable
              disabled={readonly}
              style={[
                styles.addTile,
                photo && styles.filledTile,
                readonly && !photo && styles.readonlyTile,
              ]}
              onPress={() => onAddPhoto(slotIndex)}
            >
              {photo ? (
                <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
              ) : (
                <>
                  <Text style={styles.addTilePlus}>{readonly ? '' : '+'}</Text>
                  <Text style={styles.addTileText}>{readonly ? '미첨부' : '사진첨부'}</Text>
                </>
              )}
            </Pressable>

            {!readonly && photo ? (
              <Pressable style={styles.removeChip} onPress={() => onRemovePhoto(slotIndex)}>
                <Text style={styles.removeChipText}>삭제</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      {onChangeNote ? (
        <TextInput
          value={note}
          onChangeText={onChangeNote}
          placeholder={notePlaceholder}
          placeholderTextColor="#8a938f"
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      ) : note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>내용</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default function HygieneScreen() {
  const { width } = useWindowDimensions()
  const isCompact = width < 390
  const isTablet = width >= 768

  const [activeMode, setActiveMode] = useState<HygieneMode>('register')
  const [registerDate, setRegisterDate] = useState(getToday())
  const [registerClientName, setRegisterClientName] = useState('')
  const [registerCategories, setRegisterCategories] = useState<Record<string, HygienePhotoSlot[]>>(
    createEmptyCategoryMap
  )
  const [registerNotes, setRegisterNotes] = useState<Record<string, string>>(createEmptyNoteMap)
  const [records, setRecords] = useState<HygieneRecord[]>([
    createMockRecord('mock-1', '2026-03-22', '더풀 강남점', '미조치', '1차 점검'),
    createMockRecord('mock-2', '2026-03-20', '더풀 송도점', '조치', '정기 점검'),
  ])
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>('mock-1')

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId]
  )

  const capturePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      Alert.alert('권한 필요', '현장 촬영을 위해 카메라 접근 권한이 필요합니다.')
      return null
    }

    const cameraResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.back,
      quality: 0.7,
    })

    if (cameraResult.canceled || !cameraResult.assets[0]) {
      return null
    }

    return {
      id: `${Date.now()}`,
      uri: cameraResult.assets[0].uri,
    }
  }

  const handleAddRegisterPhoto = async (categoryKey: string, slotIndex: number) => {
    const nextPhoto = await capturePhoto()

    if (!nextPhoto) {
      return
    }

    setRegisterCategories((current) => {
      const nextSlots = [...current[categoryKey]]
      nextSlots[slotIndex] = nextPhoto

      return {
        ...current,
        [categoryKey]: nextSlots,
      }
    })
  }

  const handleRemoveRegisterPhoto = (categoryKey: string, slotIndex: number) => {
    setRegisterCategories((current) => {
      const nextSlots = [...current[categoryKey]]
      nextSlots[slotIndex] = null

      return {
        ...current,
        [categoryKey]: nextSlots,
      }
    })
  }

  const handleAddActionPhoto = async (slotIndex: number) => {
    if (!selectedRecord || selectedRecord.status !== '미조치') {
      return
    }

    const nextPhoto = await capturePhoto()

    if (!nextPhoto) {
      return
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === selectedRecord.id
          ? {
              ...record,
              actionPhotos: record.actionPhotos.map((photo, index) =>
                index === slotIndex ? nextPhoto : photo
              ),
            }
          : record
      )
    )
  }

  const handleRemoveActionPhoto = (slotIndex: number) => {
    if (!selectedRecord || selectedRecord.status !== '미조치') {
      return
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === selectedRecord.id
          ? {
              ...record,
              actionPhotos: record.actionPhotos.map((photo, index) =>
                index === slotIndex ? null : photo
              ),
            }
          : record
      )
    )
  }

  const handleRegisterSubmit = () => {
    if (!registerClientName.trim()) {
      Alert.alert('거래처명 확인', '거래처명을 입력해 주세요.')
      return
    }

    const newRecord: HygieneRecord = {
      id: `${Date.now()}`,
      date: registerDate,
      clientName: registerClientName.trim(),
      status: '미조치',
      createdAt: new Date().toISOString(),
      categories: Object.fromEntries(
        Object.entries(registerCategories).map(([key, photos]) => [key, [...photos]])
      ),
      notes: { ...registerNotes },
      actionPhotos: createEmptyPhotoSlots(),
      actionNote: '',
    }

    setRecords((current) => [newRecord, ...current])
    setSelectedRecordId(newRecord.id)
    setActiveMode('action')
    setRegisterDate(getToday())
    setRegisterClientName('')
    setRegisterCategories(createEmptyCategoryMap())
    setRegisterNotes(createEmptyNoteMap())
    Alert.alert('등록 완료', '위생등록 건이 저장되었습니다.')
  }

  const handleActionNoteChange = (value: string) => {
    if (!selectedRecord || selectedRecord.status !== '미조치') {
      return
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === selectedRecord.id
          ? {
              ...record,
              actionNote: value,
            }
          : record
      )
    )
  }

  const handleCompleteAction = () => {
    if (!selectedRecord) {
      return
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === selectedRecord.id
          ? {
              ...record,
              status: '조치',
            }
          : record
      )
    )
    Alert.alert('조치 완료', '선택한 위생일지를 조치 상태로 변경했습니다.')
  }

  const actionRecords = useMemo(
    () => [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [records]
  )

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          isCompact && styles.contentCompact,
          isTablet && styles.contentTablet,
        ]}
      >
        <View style={[styles.toggleRow, isTablet && styles.toggleRowTablet]}>
          <Pressable
            style={[styles.toggleButton, activeMode === 'register' && styles.toggleButtonActive]}
            onPress={() => setActiveMode('register')}
          >
            <Text
              style={[
                styles.toggleButtonText,
                activeMode === 'register' && styles.toggleButtonTextActive,
              ]}
            >
              등록
            </Text>
          </Pressable>

          <Pressable
            style={[styles.toggleButton, activeMode === 'action' && styles.toggleButtonActive]}
            onPress={() => setActiveMode('action')}
          >
            <Text
              style={[
                styles.toggleButtonText,
                activeMode === 'action' && styles.toggleButtonTextActive,
              ]}
            >
              조치
            </Text>
          </Pressable>
        </View>

        {activeMode === 'register' ? (
          <View style={styles.panel}>
            <View style={[styles.formRow, isTablet && styles.formRowTablet]}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>등록일</Text>
                <TextInput
                  value={registerDate}
                  onChangeText={setRegisterDate}
                  placeholder="yyyy-mm-dd"
                  placeholderTextColor="#8a938f"
                  style={styles.input}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>거래처명</Text>
                <TextInput
                  value={registerClientName}
                  onChangeText={setRegisterClientName}
                  placeholder="거래처명을 입력해 주세요"
                  placeholderTextColor="#8a938f"
                  style={styles.input}
                />
              </View>
            </View>

            {photoCategories.map((category) => (
              <PhotoPickerSection
                key={category.key}
                title={category.title}
                photos={registerCategories[category.key]}
                note={registerNotes[category.key]}
                notePlaceholder={`${category.title} 관련 내용을 입력해 주세요`}
                onAddPhoto={(slotIndex) => void handleAddRegisterPhoto(category.key, slotIndex)}
                onRemovePhoto={(slotIndex) => handleRemoveRegisterPhoto(category.key, slotIndex)}
                onChangeNote={(value) =>
                  setRegisterNotes((current) => ({
                    ...current,
                    [category.key]: value,
                  }))
                }
              />
            ))}

            <Pressable style={styles.primaryButton} onPress={handleRegisterSubmit}>
              <Text style={styles.primaryButtonText}>위생등록 저장</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>조치 관리</Text>
            <Text style={styles.panelDescription}>
              이전 등록 건 목록을 확인하고, 미조치 건을 선택해서 추가 사진과 조치 내용을 남길 수 있습니다.
            </Text>

            <View style={styles.recordList}>
              {actionRecords.map((record) => {
                const isPending = record.status === '미조치'
                const isSelected = record.id === selectedRecordId

                return (
                  <Pressable
                    key={record.id}
                    disabled={!isPending}
                    onPress={() => setSelectedRecordId(record.id)}
                    style={[
                      styles.recordCard,
                      isSelected && styles.recordCardSelected,
                      !isPending && styles.recordCardDisabled,
                    ]}
                  >
                    <View style={styles.recordHeader}>
                      <Text style={styles.recordTitle}>{buildRecordTitle(record)}</Text>
                      <View
                        style={[
                          styles.statusChip,
                          record.status === '조치' ? styles.statusChipDone : styles.statusChipPending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            record.status === '조치'
                              ? styles.statusChipTextDone
                              : styles.statusChipTextPending,
                          ]}
                        >
                          {record.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.recordHint}>
                      {isPending ? '선택해서 조치 내용을 작성할 수 있습니다.' : '조치 완료된 건입니다.'}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            {selectedRecord ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>{buildRecordTitle(selectedRecord)}</Text>
                <Text style={styles.detailDescription}>
                  등록된 사진과 내용을 확인한 뒤, 아래에 추가 첨부와 조치 내용을 남겨 주세요.
                </Text>

                {photoCategories.map((category) => (
                  <PhotoPickerSection
                    key={category.key}
                    title={category.title}
                    photos={selectedRecord.categories[category.key]}
                    note={selectedRecord.notes[category.key]}
                    onAddPhoto={() => {}}
                    onRemovePhoto={() => {}}
                    readonly
                  />
                ))}

                <PhotoPickerSection
                  title="조치 첨부"
                  photos={selectedRecord.actionPhotos}
                  onAddPhoto={(slotIndex) => void handleAddActionPhoto(slotIndex)}
                  onRemovePhoto={handleRemoveActionPhoto}
                  readonly={selectedRecord.status !== '미조치'}
                />

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>조치 내용</Text>
                  <TextInput
                    value={selectedRecord.actionNote}
                    onChangeText={handleActionNoteChange}
                    placeholder="조치 내용을 입력해 주세요"
                    placeholderTextColor="#8a938f"
                    editable={selectedRecord.status === '미조치'}
                    multiline
                    textAlignVertical="top"
                    style={[styles.input, styles.largeTextArea]}
                  />
                </View>

                {selectedRecord.status === '미조치' ? (
                  <Pressable style={styles.primaryButton} onPress={handleCompleteAction}>
                    <Text style={styles.primaryButtonText}>조치 완료로 변경</Text>
                  </Pressable>
                ) : (
                  <View style={styles.doneBanner}>
                    <Text style={styles.doneBannerText}>이 건은 이미 조치 완료되었습니다.</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>미조치 건을 선택하면 상세 조치 화면이 열립니다.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe6',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36,
    gap: 18,
  },
  contentCompact: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
  },
  contentTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 980,
    paddingTop: 40,
  },
  heroCard: {
    borderRadius: 30,
    padding: 24,
    backgroundColor: '#15392d',
    gap: 12,
  },
  heroEyebrow: {
    color: '#d7bb72',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  heroTitle: {
    color: '#fff9ed',
    fontSize: 30,
    fontWeight: '800',
  },
  heroDescription: {
    color: '#d5e1da',
    fontSize: 14,
    lineHeight: 22,
  },
  toggleRow: {
    gap: 12,
  },
  toggleRowTablet: {
    flexDirection: 'row',
  },
  toggleButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d5ccbc',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf8',
  },
  toggleButtonActive: {
    backgroundColor: '#15392d',
    borderColor: '#15392d',
  },
  toggleButtonText: {
    color: '#15392d',
    fontSize: 16,
    fontWeight: '800',
  },
  toggleButtonTextActive: {
    color: '#fffdf8',
  },
  panel: {
    borderRadius: 28,
    padding: 10,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#e1d7c6',
    gap: 16,
  },
  panelTitle: {
    color: '#15392d',
    fontSize: 22,
    fontWeight: '800',
  },
  panelDescription: {
    color: '#5d6c65',
    fontSize: 14,
    lineHeight: 22,
  },
  formRow: {
    gap: 12,
  },
  formRowTablet: {
    flexDirection: 'row',
  },
  inputGroup: {
    flex: 1,
    gap: 8,
  },
  inputLabel: {
    color: '#15392d',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9d2c2',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#f8f4ec',
    color: '#15392d',
    fontSize: 15,
  },
  textArea: {
    minHeight: 96,
  },
  largeTextArea: {
    minHeight: 120,
  },
  sectionCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#f8f4ec',
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionCardTitle: {
    color: '#15392d',
    fontSize: 17,
    fontWeight: '800',
  },
  sectionCardMeta: {
    color: '#7d887f',
    fontSize: 13,
    fontWeight: '700',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoTile: {
    width: 96,
    gap: 8,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    backgroundColor: '#d7ddd8',
  },
  removeChip: {
    minHeight: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eadfd0',
  },
  removeChipText: {
    color: '#7b3f22',
    fontSize: 12,
    fontWeight: '800',
  },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#b9c5be',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fcfaf4',
    gap: 6,
  },
  filledTile: {
    padding: 0,
    borderStyle: 'solid',
    borderColor: '#d0c5b3',
    backgroundColor: '#d7ddd8',
    overflow: 'hidden',
  },
  readonlyTile: {
    borderStyle: 'solid',
    borderColor: '#d9d2c2',
    backgroundColor: '#f3ede3',
  },
  addTilePlus: {
    color: '#15392d',
    fontSize: 24,
    fontWeight: '400',
  },
  addTileText: {
    color: '#15392d',
    fontSize: 12,
    fontWeight: '700',
  },
  noteBox: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#fffdf8',
    gap: 6,
  },
  noteLabel: {
    color: '#6f7e77',
    fontSize: 12,
    fontWeight: '700',
  },
  noteText: {
    color: '#15392d',
    fontSize: 14,
    lineHeight: 21,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c69b38',
  },
  primaryButtonText: {
    color: '#1d2e26',
    fontSize: 16,
    fontWeight: '800',
  },
  recordList: {
    gap: 12,
  },
  recordCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#f8f4ec',
    borderWidth: 1,
    borderColor: '#ece3d6',
    gap: 8,
  },
  recordCardSelected: {
    borderColor: '#15392d',
    backgroundColor: '#edf2ee',
  },
  recordCardDisabled: {
    opacity: 0.8,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordTitle: {
    flex: 1,
    color: '#15392d',
    fontSize: 15,
    fontWeight: '800',
  },
  recordHint: {
    color: '#5d6c65',
    fontSize: 13,
    lineHeight: 20,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusChipPending: {
    backgroundColor: '#f9ddc6',
  },
  statusChipDone: {
    backgroundColor: '#dce8df',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  statusChipTextPending: {
    color: '#9a4d1f',
  },
  statusChipTextDone: {
    color: '#1f5a43',
  },
  detailCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#edf2ee',
    gap: 14,
  },
  detailTitle: {
    color: '#15392d',
    fontSize: 20,
    fontWeight: '800',
  },
  detailDescription: {
    color: '#5d6c65',
    fontSize: 14,
    lineHeight: 22,
  },
  doneBanner: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#dce8df',
  },
  doneBannerText: {
    color: '#1f5a43',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#f8f4ec',
  },
  emptyCardText: {
    color: '#5d6c65',
    fontSize: 14,
    lineHeight: 22,
  },
})
