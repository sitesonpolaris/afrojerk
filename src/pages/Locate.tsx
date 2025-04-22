import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, MapPin, Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import Schedule from '../components/Schedule';
import { toast } from 'react-hot-toast';
import type { Database } from '../lib/database.types';

let loadingPromise: Promise<void> | null = null;

const loadGoogleMaps = () => {
  if (loadingPromise) {
    return loadingPromise;
  }
  
  loadingPromise = new Promise<void>((resolve) => {
    // If the API is already loaded, resolve immediately
    if (window.google && window.google.maps) {
      loadingPromise = null;
      resolve();
      return;
    }
    
    // Create a global callback
    const callbackName = '__googleMapsApiOnLoadCallback';
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&callback=${callbackName}&libraries=places&v=3.54`;
    script.async = true;
    script.defer = true;
    script.onerror = (error) => {
      console.error('Google Maps script failed to load:', error);
      loadingPromise = null;
    };
    
    window[callbackName] = () => {
      loadingPromise = null;
      resolve();
      delete window[callbackName];
    }
    
    document.head.appendChild(script);
  });
  
  return loadingPromise;
};

type Schedule = Database['public']['Tables']['schedules']['Row'];
type Location = Database['public']['Tables']['locations']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'];

interface ScheduleWithLocation extends Schedule {
  location: Location;
}

declare global {
  interface Window {
    google: any;
    __googleMapsApiOnLoadCallback?: () => void;
  }
}

export default function Locate() {
  const navigate = useNavigate();
  const [currentSchedule, setCurrentSchedule] = useState<ScheduleWithLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    customerName: '',
    rating: 5,
    comment: '',
    image: null as File | null
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const initializeComponent = async () => {
      await loadGoogleMaps();
      await fetchTodaySchedule();
      await fetchReviews();
    };
    
    initializeComponent();

    // Cleanup function to remove map references when component unmounts
    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (googleMapRef.current) {
        googleMapRef.current = null;
      }
    };
  }, []);

  async function fetchTodaySchedule() {
    try {
      console.log('Fetching today\'s schedule...');
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('schedules')
        .select(`
          *,
          location:locations(*)
        `)
        .eq('date', today)
        .order('start_time', { ascending: true })
        .limit(1);

      if (error) throw error;
      
      // Handle the case where no schedule is found
      if (!data || data.length === 0) {
        console.log('No schedule found for today');
        setCurrentSchedule(null);
        return;
      }

      // Take the first schedule if multiple exist
      console.log('Schedule data received:', data[0]);
      setCurrentSchedule(data[0]);
      
      // Initialize map after schedule is loaded
      if (data[0] && mapRef.current && !googleMapRef.current) {
        console.log('Initializing map with location:', data[0].location);
        initializeMap(data[0]);
      }
    } catch (error) {
      console.error('Error fetching schedule:', error);
      toast.error('Failed to fetch today\'s schedule');
    } finally {
      setLoading(false);
    }
  }
  
  const initializeMap = (schedule: ScheduleWithLocation) => {
    console.log('Map initialization started');
    if (!mapRef.current || !window.google || !window.google.maps) {
      console.error("Map initialization failed:", {
        mapRef: !!mapRef.current,
        googleObject: !!window.google,
        mapsObject: window.google?.maps ? 'exists' : 'missing'
      });
      toast.error('Failed to load map. Please refresh the page.');
      return;
    }
    
    const { lat, lng } = schedule.location;
    console.log('Map coordinates:', { lat, lng });
    const mapOptions = {
      center: { lat, lng },
      zoom: 15,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }]
        }
      ]
    };
    
    const map = new window.google.maps.Map(mapRef.current, mapOptions);
    googleMapRef.current = map;
    console.log('Google Map instance created');
    
    // Add custom marker
    const marker = new window.google.maps.Marker({
      position: { lat, lng },
      map,
      title: schedule.location.name,
      icon: {
        url: 'https://cnkalkntbjisvbpjtojk.supabase.co/storage/v1/object/public/media//truckAsset%201.svg',
        scaledSize: new window.google.maps.Size(40, 40)
      }
    });
    markerRef.current = marker;
    console.log('Map marker added');
    
    // Add info window
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div class="p-2">
          <h3 class="font-bold">${schedule.location.name}</h3>
          <p class="text-sm">${schedule.location.address}</p>
        </div>
      `
    });
    
    marker.addListener('click', () => {
      infoWindow.open(map, marker);
    });
  };

  async function fetchReviews() {
    try {
      console.log('Fetching reviews...');
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      console.log('Reviews data received:', data);
      setReviews(data);
    } catch (error) {
      console.error('Error fetching reviews:', error);
    }
  }

  const handleImageUpload = async (file: File) => {
    try {
      console.log('Starting image upload:', { fileName: file.name, fileSize: file.size });
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(filePath, file);

      if (uploadError) throw uploadError;
      console.log('Image uploaded successfully');

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);

      console.log('Generated public URL:', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    console.log('Starting review submission:', { ...reviewForm, image: reviewForm.image?.name });

    try {
      let imageUrl = null;
      if (reviewForm.image) {
        console.log('Uploading review image...');
        imageUrl = await handleImageUpload(reviewForm.image);
      }

      const { error } = await supabase
        .from('reviews')
        .insert([{
          customer_name: reviewForm.customerName,
          rating: reviewForm.rating,
          comment: reviewForm.comment,
          image_url: imageUrl
        }]);

      if (error) throw error;
      console.log('Review submitted successfully');

      toast.success('Review submitted successfully!');
      setIsReviewModalOpen(false);
      setReviewForm({
        customerName: '',
        rating: 5,
        comment: '',
        image: null
      });
      fetchReviews();
    } catch (error) {
      console.error('Error submitting review:', error);
      toast.error('Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-16 bg-gray-50">
        <div className="container mx-auto px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-64 bg-gray-200 rounded-xl" />
            <div className="h-8 bg-gray-200 rounded w-1/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16 bg-gray-50">
      {/* Map Section */}
      <div className="h-[50vh] relative">
        <div 
          ref={mapRef} 
          className="w-full h-full bg-gray-100"
          style={{ opacity: currentSchedule ? 1 : 0.5 }}
        >
          {(!currentSchedule || !window.google) && (
          <div className="h-full bg-gray-200 flex items-center justify-center">
            <p className="text-gray-500">
              {!currentSchedule ? 'No schedule available for today' : 'Map failed to load'}
            </p>
          </div>
          )}
        </div>
      </div>

      {/* Location Info */}
      <div className="container mx-auto px-4 py-8">
        {currentSchedule ? (
          <div className="bg-white rounded-xl p-6 shadow-sm -mt-16 relative z-10 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Today's Location</h1>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#eb1924] mt-1" />
                <div>
                  <p className="font-medium">{currentSchedule.location.name}</p>
                  <p className="text-gray-600">{currentSchedule.location.address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <p>Hours: {format(new Date(`2000-01-01T${currentSchedule.start_time}`), 'h:mm aa')} - {format(new Date(`2000-01-01T${currentSchedule.end_time}`), 'h:mm aa')}</p>
              </div>
              <button
                onClick={() => navigate('/order')}
                className="w-full bg-[#eb1924] text-white py-3 rounded-full hover:bg-[#eb1924]/90 transition-colors"
              >
                Order Now
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 shadow-sm -mt-16 relative z-10 max-w-2xl mx-auto text-center">
            <p className="text-gray-600">We're not operating today. Check our schedule for upcoming locations!</p>
          </div>
        )}

        {/* Schedule Section */}
        <div className="max-w-4xl mx-auto mt-12 mb-12">
          <Schedule />
        </div>
        
        {/* Reviews Section */}
        <div className="max-w-4xl mx-auto mt-12">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold">Customer Reviews</h2>
            <button
              onClick={() => setIsReviewModalOpen(true)}
              className="bg-[#01a952] text-white px-6 py-2 rounded-full hover:bg-[#01a952]/90 transition-colors"
            >
              Write a Review
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-medium">{review.customer_name}</h3>
                    <div className="flex items-center gap-1 text-yellow-400">
                      {Array.from({ length: review.rating }).map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-current" />
                      ))}
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">
                    {format(new Date(review.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
                {review.image_url && (
                  <img
                    src={review.image_url}
                    alt="Review"
                    className="w-full h-48 object-cover rounded-lg mb-4"
                  />
                )}
                <p className="text-gray-600">{review.comment}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {isReviewModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="flex justify-between items-center p-4 border-b">
              <h2 className="text-xl font-bold">Write a Review</h2>
              <button
                onClick={() => setIsReviewModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitReview} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={reviewForm.customerName}
                  onChange={(e) => setReviewForm({ ...reviewForm, customerName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#eb1924] focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rating
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => setReviewForm({ ...reviewForm, rating })}
                      className={`p-2 rounded-full ${
                        reviewForm.rating >= rating ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                    >
                      <Star className="w-6 h-6 fill-current" />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Review
                </label>
                <textarea
                  value={reviewForm.comment}
                  onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#eb1924] focus:border-transparent"
                  rows={4}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Add Photo (Optional)
                </label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg">
                  <div className="space-y-1 text-center">
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <div className="flex text-sm text-gray-600">
                      <label className="relative cursor-pointer rounded-md bg-white font-medium text-[#eb1924] focus-within:outline-none focus-within:ring-2 focus-within:ring-[#eb1924] focus-within:ring-offset-2 hover:text-[#eb1924]/90">
                        <span>Upload a file</span>
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setReviewForm({ ...reviewForm, image: file });
                            }
                          }}
                        />
                      </label>
                      <p className="pl-1">or drag and drop</p>
                    </div>
                    <p className="text-xs text-gray-500">PNG, JPG up to 10MB</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsReviewModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-[#01a952] text-white hover:bg-[#01a952]/90 transition-colors disabled:bg-gray-400"
                >
                  {submitting ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}